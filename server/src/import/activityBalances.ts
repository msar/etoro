import {
  iterateCsv,
  parseEtoroDateTime,
  parseNum,
  toIsoDate,
} from './csvUtil.js';

export interface BalanceImportRow {
  date: string;
  cash: number;
  invested: number;
  pnl: number;
  total: number;
  net_flow: number;
}

const DEPOSIT_TYPES = new Set(['Depósito', 'Deposit']);
const WITHDRAW_TYPES = new Set(['Solicitud de retirada', 'Withdrawal', 'Withdraw']);
const WITHDRAW_CANCEL_TYPES = new Set(['Withdraw Request Cancelled']);

function externalFlow(tipo: string, importe: number): number {
  if (DEPOSIT_TYPES.has(tipo)) return importe;
  if (WITHDRAW_TYPES.has(tipo)) return importe; // already negative in export
  if (WITHDRAW_CANCEL_TYPES.has(tipo)) return importe; // positive refund
  return 0;
}

/**
 * Build end-of-day balance_snapshots from Account Activity.
 *
 * Uses Realized Equity (`Capital realizado`) and cash (`Saldo`).
 * Unrealized PnL is not in the statement → pnl is stored as 0;
 * invested is approximated as max(0, total − cash).
 *
 * Days without activity are forward-filled so charts stay continuous.
 */
export async function buildBalancesFromActivity(
  csvPath: string,
  options: { beforeDate?: string } = {},
): Promise<BalanceImportRow[]> {
  type DayAcc = {
    cash: number;
    total: number;
    netFlow: number;
  };

  const byDay = new Map<string, DayAcc>();

  for await (const row of iterateCsv(csvPath)) {
    const dt = parseEtoroDateTime(row['Fecha']);
    if (!dt) continue;
    const day = toIsoDate(dt);
    if (options.beforeDate && day >= options.beforeDate) continue;

    const cash = parseNum(row['Saldo']);
    const total = parseNum(row['Capital realizado']);
    const flow = externalFlow(row['Tipo'] ?? '', parseNum(row['Importe']));

    const prev = byDay.get(day);
    if (!prev) {
      byDay.set(day, { cash, total, netFlow: flow });
    } else {
      // Last row of the day wins for levels; accumulate external flows.
      prev.cash = cash;
      prev.total = total;
      prev.netFlow += flow;
    }
  }

  const days = [...byDay.keys()].sort();
  if (days.length === 0) return [];

  // Forward-fill calendar gaps
  const start = new Date(`${days[0]}T00:00:00Z`);
  const end = new Date(`${days[days.length - 1]}T00:00:00Z`);
  const out: BalanceImportRow[] = [];
  let last: DayAcc | null = null;

  for (let t = start.getTime(); t <= end.getTime(); t += 86_400_000) {
    const day = new Date(t).toISOString().slice(0, 10);
    const hit = byDay.get(day);
    if (hit) {
      last = hit;
      const invested = Math.max(0, hit.total - hit.cash);
      out.push({
        date: day,
        cash: hit.cash,
        invested,
        pnl: 0,
        total: hit.total,
        net_flow: hit.netFlow,
      });
    } else if (last) {
      out.push({
        date: day,
        cash: last.cash,
        invested: Math.max(0, last.total - last.cash),
        pnl: 0,
        total: last.total,
        net_flow: 0,
      });
    }
  }

  // First day's net_flow is a baseline deposit — keep it (charts treat idx0 specially
  // as cost-basis seed via total−pnl, but storing the deposit is still accurate).
  return out;
}
