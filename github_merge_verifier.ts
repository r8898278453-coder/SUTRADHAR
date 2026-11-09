/**
 * GitHub read-only merge gatekeeper. No auto-merge, push, revert or repository
 * mutation. Every decision is based on authenticated live GitHub REST responses.
 */
export type VerifiedMerge = {
  verified: true;
  repo: string;
  prNumber: number;
  branch: string;
  headSha: string;
  mergeSha: string;
  treeSha: string;
};
export type MergeDenial = { verified: false; error: string };
export type GitHubFetcher = (url: string, init?: RequestInit) => Promise<Response>;

export type MergeVerificationInput = {
  repo: string;
  token: string;
  branch: string;
  allowedFiles: string[];
  baselineCommit: string;
  candidateTreeSha: string;
  requiredChecks: string[];
  requiredApprovals: number;
  expectedPrNumber?: number;
  expectedHeadSha?: string;
  mainBranch?: string;
  checkAppSlug?: string;
  fetcher?: GitHubFetcher;
};

const shaPattern = /^[0-9a-f]{40}$/;
const repoPattern = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const branchPattern = /^(ai|worker-[a-zA-Z0-9-]+)\/[a-zA-Z0-9_.\/-]+$/;

export async function verifyGitHubMergeEvidence(input: MergeVerificationInput):
  Promise<VerifiedMerge | MergeDenial> {
  const deny = (error: string): MergeDenial => ({ verified: false, error });
  const branch = input.mainBranch || 'main';
  const checkSlug = input.checkAppSlug || 'github-actions';
  if (!repoPattern.test(input.repo) || !branchPattern.test(input.branch) ||
      !/^[a-zA-Z0-9._-]+$/.test(branch) || !shaPattern.test(input.baselineCommit) ||
      !shaPattern.test(input.candidateTreeSha) || !input.token?.trim() ||
      !input.allowedFiles?.length || !input.requiredChecks?.length ||
      !input.requiredChecks.every(s => typeof s === 'string' && s.trim().length > 0) ||
      !Number.isInteger(input.requiredApprovals) || input.requiredApprovals < 1 ||
      input.requiredApprovals > 5 ||
      (input.expectedPrNumber !== undefined &&
        (!Number.isSafeInteger(input.expectedPrNumber) || input.expectedPrNumber < 1)) ||
      (input.expectedHeadSha !== undefined && !shaPattern.test(input.expectedHeadSha))) {
    return deny('GITHUB_VERIFICATION_NOT_CONFIGURED');
  }
  const allowed = new Set(input.allowedFiles);
  const base = `https://api.github.com/repos/${input.repo}`;
  const fetcher = input.fetcher || fetch;
  class GithubRequestError extends Error {}
  async function getJson(uri: string): Promise<any> {
    const response = await fetcher(base + uri, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${input.token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28'
      },
      signal: AbortSignal.timeout(15000)
    });
    if (!response.ok) throw new GithubRequestError(`HTTP_${response.status}`);
    return response.json();
  }

  try {
    const [owner] = input.repo.split('/');
    const query = new URLSearchParams({
      state: 'closed', base: branch, head: `${owner}:${input.branch}`, per_page: '100'
    });
    const prs = await getJson(`/pulls?${query.toString()}`);
    if (!Array.isArray(prs) || prs.length > 100) return deny('GITHUB_BAD_PR_RESPONSE');
    const matching = prs.filter((p: any) =>
      p?.merged_at && p?.draft === false &&
      p?.head?.ref === input.branch && p?.head?.repo?.full_name === input.repo &&
      p?.base?.ref === branch && p?.base?.repo?.full_name === input.repo &&
      typeof p?.merge_commit_sha === 'string' && shaPattern.test(p.merge_commit_sha) &&
      shaPattern.test(p?.head?.sha || '') && p?.commits === 1 &&
      typeof p?.number === 'number' && Number.isSafeInteger(p.number) &&
      (input.expectedPrNumber === undefined || p.number === input.expectedPrNumber) &&
      (input.expectedHeadSha === undefined || p.head.sha === input.expectedHeadSha));
    if (matching.length !== 1) return deny('GITHUB_MERGED_PR_NOT_UNAMBIGUOUS');
    const pr = matching[0];
    const headSha = String(pr.head.sha);
    const mergeSha = String(pr.merge_commit_sha);
    const [headCommit, mergedCommit, files, checks, reviews, ancestry] = await Promise.all([
      getJson(`/git/commits/${headSha}`),
      getJson(`/git/commits/${mergeSha}`),
      getJson(`/pulls/${pr.number}/files?per_page=100`),
      getJson(`/commits/${headSha}/check-runs?per_page=100`),
      getJson(`/pulls/${pr.number}/reviews?per_page=100`),
      getJson(`/compare/${mergeSha}...${encodeURIComponent(branch)}`)
    ]);
    // Exactly one code commit built on the immutable tested Git baseline.
    if (headCommit?.sha !== headSha ||
        !Array.isArray(headCommit?.parents) || headCommit.parents.length !== 1 ||
        headCommit.parents[0]?.sha !== input.baselineCommit ||
        headCommit?.tree?.sha !== input.candidateTreeSha ||
        mergedCommit?.sha !== mergeSha ||
        mergedCommit?.tree?.sha !== input.candidateTreeSha) {
      return deny('GITHUB_TESTED_TREE_MISMATCH');
    }
    if (ancestry?.status !== 'ahead' && ancestry?.status !== 'identical') {
      return deny('GITHUB_MERGE_NOT_ON_MAIN');
    }
    if (ancestry?.base_commit?.sha !== mergeSha) {
      return deny('GITHUB_MERGE_NOT_ON_MAIN');
    }
    if (!Array.isArray(files) || files.length === 0 || files.length >= 100 ||
        pr.changed_files !== files.length ||
        files.some((f: any) => typeof f?.filename !== 'string' ||
          !allowed.has(f.filename) || f.status === 'renamed' || !['added', 'modified', 'removed'].includes(f.status))) {
      return deny('GITHUB_PR_FILE_SCOPE_MISMATCH');
    }
    if (!checks || !Array.isArray(checks.check_runs) || checks.total_count >= 100) {
      return deny('GITHUB_REQUIRED_CHECKS_MISSING');
    }
    for (const required of new Set(input.requiredChecks)) {
      const runs = checks.check_runs.filter((c: any) => c?.name === required && c?.head_sha === headSha &&
        c?.app?.slug === checkSlug);
      if (!runs.length || runs.some((c: any) => c.status !== 'completed' || c.conclusion !== 'success')) {
        return deny('GITHUB_REQUIRED_CHECKS_MISSING');
      }
    }
    if (!Array.isArray(reviews) || reviews.length >= 100) return deny('GITHUB_APPROVAL_NOT_VERIFIED');
    const latest = new Map<string, any>();
    const reviewsSorted = reviews
      .filter((r: any) => r?.user?.login && r?.submitted_at &&
        new Date(r.submitted_at).getTime() <= new Date(pr.merged_at).getTime())
      .sort((a: any, b: any) => new Date(a.submitted_at).getTime() - new Date(b.submitted_at).getTime());
    for (const review of reviewsSorted) latest.set(review.user.login, review);
    let approvals = 0;
    for (const [reviewer, review] of latest) {
      if (reviewer !== pr.user?.login && review.state === 'APPROVED') approvals++;
    }
    if (approvals < input.requiredApprovals) return deny('GITHUB_APPROVAL_NOT_VERIFIED');
    return { verified: true, repo: input.repo, prNumber: pr.number, branch: input.branch,
      headSha, mergeSha, treeSha: input.candidateTreeSha };
  } catch (error) {
    // Never leak a GitHub credential, request URL or arbitrary remote response.
    return deny('GITHUB_API_UNAVAILABLE');
  }
}
