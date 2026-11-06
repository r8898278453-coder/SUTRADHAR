/**
 * Protected draft PR creator for an ALREADY PUSHED worker branch.
 * No branch creation, git push, or merge. GitHub is queried before PR creation
 * to match the exact commit/tree that passed real Docker testing.
 */
export type DraftPrResult =
  | { created: true; existing: boolean; prNumber: number; url: string; headSha: string; treeSha: string; branch: string; repo: string }
  | { created: false; error: string };
export type DraftPrFetcher = (url: string, init?: RequestInit) => Promise<Response>;
export type DraftPrInput = {
  repo: string; token: string; branch: string; ticketId: string;
  baselineCommit: string; candidateTreeSha: string;
  changedFiles: string[]; allowedFiles: string[];
  title: string; description: string;
  fetcher?: DraftPrFetcher;
};

const sha = /^[0-9a-f]{40}$/;
const repoPattern = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const branchPattern = /^(?:ai\/[A-Za-z0-9_.-]+|worker-[A-Za-z0-9-]+\/ticket-[A-Za-z0-9_.-]+)$/;
const safePath = (p: string) =>
  !!p && !p.startsWith('/') && !p.startsWith('-') && !p.includes('\\') &&
  !p.split('/').some(part => !part || part === '.' || part === '..') &&
  p.length < 500;

export async function createVerifiedDraftPr(input: DraftPrInput): Promise<DraftPrResult> {
  const deny = (error: string): DraftPrResult => ({ created: false, error });
  const { repo, branch, ticketId, baselineCommit, candidateTreeSha } = input;
  const changed = new Set(input.changedFiles || []);
  const allowed = new Set(input.allowedFiles || []);
  if (!repoPattern.test(repo || '') || !branchPattern.test(branch || '') ||
      !ticketId || ticketId.length > 128 || !sha.test(baselineCommit || '') ||
      !sha.test(candidateTreeSha || '') || !input.token?.trim() ||
      changed.size === 0 || changed.size >= 100 ||
      changed.size !== input.changedFiles.length ||
      ![...changed].every(file => safePath(file) && allowed.has(file)) ||
      !input.title || input.title.length > 180) {
    return deny('DRAFT_PR_CONFIGURATION_INVALID');
  }
  const api = `https://api.github.com/repos/${repo}`;
  const fetcher = input.fetcher || fetch;
  async function request(uri: string, method: 'GET' | 'POST' = 'GET', data?: unknown): Promise<any> {
    const r = await fetcher(api + uri, {
      method,
      headers: {
        Authorization: `Bearer ${input.token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        ...(data === undefined ? {} : { 'Content-Type': 'application/json' })
      },
      ...(data === undefined ? {} : { body: JSON.stringify(data) }),
      signal: AbortSignal.timeout(15000)
    });
    if (!r.ok) throw new Error('GitHub request failed');
    return r.json();
  }
  try {
    const base = await request('/branches/main');
    if (base?.commit?.sha !== baselineCommit) return deny('DRAFT_PR_MAIN_MOVED_RETEST_REQUIRED');
    // A branch is expected to be pushed by the worker's scoped Git workflow.
    // This endpoint never creates/overwrites refs or uploads untested content.
    const safeBranch = branch.split('/').map(encodeURIComponent).join('/');
    const remote = await request(`/branches/${safeBranch}`);
    const headSha = remote?.commit?.sha;
    if (typeof headSha !== 'string' || !sha.test(headSha) || headSha === baselineCommit) {
      return deny('DRAFT_PR_BRANCH_NOT_PUSHED');
    }
    const [commit, comparison] = await Promise.all([
      request(`/git/commits/${headSha}`),
      request(`/compare/${baselineCommit}...${headSha}`)
    ]);
    if (commit?.sha !== headSha || commit?.tree?.sha !== candidateTreeSha ||
        !Array.isArray(commit?.parents) || commit.parents.length !== 1 ||
        commit.parents[0]?.sha !== baselineCommit ||
        comparison?.status !== 'ahead' || comparison?.ahead_by !== 1 ||
        comparison?.behind_by !== 0 || comparison?.total_commits !== 1 ||
        !Array.isArray(comparison?.files) ||
        comparison.files.length !== changed.size ||
        comparison.files.length >= 100 ||
        comparison.files.some((file: any) =>
          !changed.has(file?.filename) || !safePath(file.filename) ||
          !allowed.has(file.filename) ||
          !['added', 'modified', 'removed'].includes(file.status) ||
          file.previous_filename)) {
      return deny('DRAFT_PR_TESTED_COMMIT_MISMATCH');
    }

    const [owner] = repo.split('/');
    const query = new URLSearchParams({
      state: 'all', head: `${owner}:${branch}`, base: 'main', per_page: '100'
    });
    const existing = await request(`/pulls?${query.toString()}`);
    if (!Array.isArray(existing) || existing.length >= 100) return deny('DRAFT_PR_LIST_INCOMPLETE');
    const candidates = existing.filter((pr: any) =>
      pr?.head?.ref === branch && pr.head.repo?.full_name === repo &&
      pr?.base?.ref === 'main' && pr.base.repo?.full_name === repo);
    if (candidates.length) {
      if (candidates.length !== 1 || candidates[0].state !== 'open' ||
          candidates[0].draft !== true || candidates[0].head.sha !== headSha ||
          !Number.isSafeInteger(candidates[0].number) ||
          candidates[0].number < 1 ||
          typeof candidates[0].html_url !== 'string') {
        return deny('DRAFT_PR_BRANCH_ALREADY_USED');
      }
      return { created: true, existing: true, prNumber: candidates[0].number,
        url: candidates[0].html_url, headSha, treeSha: candidateTreeSha, branch, repo };
    }

    const body = [
      'SUTRADHAR: Human review required. This is NOT merged.',
      `Ticket: ${ticketId}`, `Tested baseline: ${baselineCommit}`,
      `Tested candidate tree: ${candidateTreeSha}`,
      `Changed files: ${[...changed].sort().join(', ')}`,
      '', (input.description || '').slice(0, 1600)
    ].join('\n').slice(0, 3500);
    const created = await request('/pulls', 'POST', {
      title: input.title.slice(0, 180), head: branch,
      base: 'main', draft: true, body
    });
    // A concurrent worker push could change HEAD between preflight and PR create.
    // Never persist mismatched PR evidence; draft remains review-only.
    if (created?.draft !== true || created?.state !== 'open' ||
        created?.head?.ref !== branch || created.head.sha !== headSha ||
        created.head.repo?.full_name !== repo ||
        created?.base?.ref !== 'main' || created.base.repo?.full_name !== repo ||
        !Number.isSafeInteger(created.number) || created.number < 1 ||
        typeof created.html_url !== 'string') {
      return deny('DRAFT_PR_RESPONSE_HEAD_CHANGED_MANUAL_REVIEW');
    }
    return { created: true, existing: false, prNumber: created.number,
      url: created.html_url, headSha, treeSha: candidateTreeSha, branch, repo };
  } catch {
    // The caller must not treat an API error (even after POST) as success.
    return deny('DRAFT_PR_GITHUB_API_UNAVAILABLE');
  }
}
