import { cached, TTL } from './cache.js';
import { EtoroApiError } from './errors.js';
import { etoroFetch } from './etoroClient.js';
import type {
  AgentPortfolioItem,
  BalancesResponse,
  GetAgentPortfoliosResponse,
  PeopleUser,
  PnlResponse,
  TradingEnv,
} from './etoroTypes.js';

export interface BootstrapInfo {
  environment: TradingEnv;
  gcid: number | null;
  username: string | null;
  fullName: string | null;
  displayCurrency: string;
  tradingAccountId: string | null;
  agentPortfolios: AgentPortfolioItem[];
}

/**
 * Probe once per key: 200 on the real PnL endpoint means a real key,
 * 403 InsufficientPermissions means a demo key. Cached for the process.
 */
async function probeEnvironment(): Promise<TradingEnv> {
  try {
    await etoroFetch<PnlResponse>('/api/v1/trading/info/real/pnl');
    return 'real';
  } catch (err) {
    if (err instanceof EtoroApiError && (err.statusCode === 403 || err.statusCode === 401)) {
      // Confirm the demo path actually works before classifying as demo
      await etoroFetch<PnlResponse>('/api/v1/trading/info/demo/pnl');
      return 'demo';
    }
    throw err;
  }
}

function extractUsername(user: PeopleUser | undefined): {
  username: string | null;
  fullName: string | null;
} {
  if (!user) return { username: null, fullName: null };
  return {
    username: user.username ?? user.userName ?? null,
    fullName: user.fullName ?? null,
  };
}

async function resolveUser(gcid: number): Promise<{ username: string | null; fullName: string | null }> {
  try {
    // cidList must be joined with a literal ',' — single ID here, still raw.
    const res = await etoroFetch<unknown>(`/api/v1/user-info/people?cidList=${gcid}`);
    // Response envelope shape is not strictly documented; handle the common ones.
    const arr: PeopleUser[] = Array.isArray(res)
      ? (res as PeopleUser[])
      : ((res as { users?: PeopleUser[]; items?: PeopleUser[] })?.users ??
        (res as { items?: PeopleUser[] })?.items ??
        []);
    return extractUsername(arr[0]);
  } catch (err) {
    console.warn('Could not resolve username from gcid:', (err as Error).message);
    return { username: null, fullName: null };
  }
}

export function getBootstrap(): Promise<BootstrapInfo> {
  return cached('bootstrap', TTL.BOOTSTRAP, async () => {
    const environment = await probeEnvironment();

    let gcid: number | null = null;
    let tradingAccountId: string | null = null;
    let displayCurrency = 'USD';
    try {
      const balances = await etoroFetch<BalancesResponse>(
        '/api/v1/balances?accountTypes=Trading&includeZeroBalances=true',
      );
      gcid = balances.gcid ?? null;
      displayCurrency = balances.displayCurrency ?? 'USD';
      // accountType arrives as the string 'Trading' on some deployments and as
      // the numeric enum value 1 on others — accept both.
      const trading = balances.balances?.find(
        (b) => b.accountType === 'Trading' || b.accountType === 1,
      );
      tradingAccountId = trading?.accountId ?? null;
    } catch (err) {
      console.warn('Balances lookup failed:', (err as Error).message);
    }

    let agentPortfolios: AgentPortfolioItem[] = [];
    try {
      const res = await etoroFetch<GetAgentPortfoliosResponse>('/api/v1/agent-portfolios');
      agentPortfolios = res.agentPortfolios ?? [];
    } catch (err) {
      // Non-agent keys may not have access to this endpoint; that's fine.
      console.warn('Agent portfolios lookup failed (ok for non-agent keys):', (err as Error).message);
    }

    // Agent-portfolio user tokens act on the agent portfolio's own gcid.
    if (gcid === null && agentPortfolios.length > 0) {
      gcid = agentPortfolios[0].agentPortfolioGcid;
    }

    let username: string | null = null;
    let fullName: string | null = null;
    if (gcid !== null) {
      ({ username, fullName } = await resolveUser(gcid));
    }

    return {
      environment,
      gcid,
      username,
      fullName,
      displayCurrency,
      tradingAccountId,
      agentPortfolios,
    };
  });
}
