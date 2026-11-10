/**
 * Read-only GitHub PR lookup for an *uncertain* rollback operation.
 * NEVER issues POST, PUT, PATCH or DELETE, and never assumes a PR was
 * created merely because a branch exists.
 */
export type RollbackPrInspection =
  | { verified: true; state: 'ABSENT' }
  | { verified: true; state: 'DRAFT_PR'; prNumber: number; url: string }
  | { verified: false; error: string };

export type RollbackRecoveryFetcher = (url: string, init?: RequestInit) => Promise<Response>;

export type RollbackPrInspectionInput = {
  repo: string;
  token: string;
  branch: string;
  originalMergeSha: string;
  branchHeadSha: string | null;
  restoredTreeSha: string | null;
  changedFiles: string[];
  allowedFiles: string[];
  fetcher?: RollbackRecoveryFetcher;
};

const sha = /^[0-9a-f]{40}$/;
const repository = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const branch = /^rollback\/[A-Za-z0-9][A-Za-z0-9_.-]{0,85}$/;
const safeFile = (p: string) => !!p && !p.startsWith('/') &&
  !p.startsWith('-') && !p.includes('\\') &&
  p.length < 500 && !p.split('/').some(c => !c || c === '.' || c === '..');

export async function inspectRollbackDraftPr(
  input: RollbackPrInspectionInput
): Promise<RollbackPrInspection> {
  const deny = (error: string): RollbackPrInspection => ({ verified: false, error });
  const changed = new Set(input.changedFiles || []);
  const allowed = new Set(input.allowedFiles || []);
  if (!repository.test(input.repo || '') || !branch.test(input.branch || '') ||
      !sha.test(input.originalMergeSha || '') ||
      !input.token?.trim() ||
      (input.branchHeadSha !== null && !sha.test(input.branchHeadSha || '')) ||
      (input.branchHeadSha !== null &&
        !sha.test(input.restoredTreeSha || '')) ||
      changed.size === 0 || changed.size >= 100 ||
      changed.size !== input.changedFiles.length ||
      ![...changed].every(f => safeFile(f) && allowed.has(f))) {
    return deny('ROLLBACK_PR_INSPECTION_INVALID');
  }

  const fetcher = input.fetcher || fetch;
  const api = `https://api.github.com/repos/${input.repo}`;
  async function get(path: string): Promise<any> {
    const response = await fetcher(api + path, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${input.token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28'
      },
      signal: AbortSignal.timeout(15000)
    });
    if (!response.ok) throw new Error('GITHUB_READ_ONLY_INSPECTION_FAILED');
    return response.json();
  }

  try {
    const main = await get('/branches/main');
    if (main?.commit?.sha !== input.originalMergeSha) {
      return deny('ROLLBACK_MAIN_MOVED_MANUAL_REVIEW');
    }

    if (input.branchHeadSha !== null) {
      const branchPath = input.branch.split('/').map(encodeURIComponent).join('/');
      const remote = await get(`/branches/${branchPath}`);
      if (remote?.commit?.sha !== input.branchHeadSha) {
        return deny('ROLLBACK_REMOTE_BRANCH_CHANGED');
      }
      const [commit, comparison] = await Promise.all([
        get(`/git/commits/${input.branchHeadSha}`),
        get(`/compare/${input.originalMergeSha}...${input.branchHeadSha}`)
      ]);
      if (commit?.sha !== input.branchHeadSha ||
          commit?.tree?.sha !== input.restoredTreeSha ||
          !Array.isArray(commit?.parents) || commit.parents.length !== 1 ||
          commit.parents[0]?.sha !== input.originalMergeSha ||
          comparison?.status !== 'ahead' ||
          comparison?.ahead_by !== 1 || comparison?.behind_by !== 0 ||
          comparison?.total_commits !== 1 ||
          !Array.isArray(comparison?.files) ||
          comparison.files.length !== changed.size ||
          comparison.files.some((file: any) =>
            !safeFile(file?.filename) || !changed.has(file.filename) ||
            !allowed.has(file.filename) ||
            !['added', 'modified', 'removed'].includes(file.status) ||
            file.previous_filename)) {
        return deny('ROLLBACK_PR_REMOTE_COMMIT_MISMATCH');
      }
    }

    const owner = input.repo.split('/')[0];
    const query = new URLSearchParams({
      state: 'all', head: `${owner}:${input.branch}`,
      base: 'main', per_page: '100'
    });
    const prs = await get(`/pulls?${query.toString()}`);
    if (!Array.isArray(prs) || prs.length >= 100) {
      return deny('ROLLBACK_PR_LIST_INCOMPLETE');
    }
    // Do not trust search filters alone; GitHub's response must independently
    // bind the exact source repo, branch, target and original baseline.
    const matches = prs.filter((pr: any) =>
      pr?.head?.ref === input.branch &&
      pr?.head?.repo?.full_name === input.repo &&
      pr?.base?.ref === 'main' &&
      pr?.base?.repo?.full_name === input.repo);
    if (matches.length === 0) {
      return { verified: true, state: 'ABSENT' };
    }
    if (matches.length !== 1 || input.branchHeadSha === null ||
        matches[0].state !== 'open' || matches[0].draft !== true ||
        matches[0].head.sha !== input.branchHeadSha ||
        matches[0].base.sha !== input.originalMergeSha ||
        !Number.isSafeInteger(matches[0].number) || matches[0].number < 1 ||
        typeof matches[0].html_url !== 'string' ||
        matches[0].html_url !==
          `https://github.com/${input.repo}/pull/${matches[0].number}`) {
      return deny('ROLLBACK_PR_CONFLICT_REQUIRES_REVIEW');
    }
    return {
      verified: true, state: 'DRAFT_PR',
      prNumber: matches[0].number, url: matches[0].html_url
    };
  } catch {
    return deny('ROLLBACK_GITHUB_READ_UNAVAILABLE');
  }
}
