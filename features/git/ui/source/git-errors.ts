"use client";

/**
 * Reading a git error: which ones are not failures, and what to show for the
 * ones that are.
 *
 * `status` answers "not a git repository" for a plain folder, and a git command
 * answers an unborn HEAD or an invalid reference while the repository is still
 * being set up; reporting either as an error would put a red toast over a panel
 * that is working as designed.
 */

/** Error fragments that mean "no usable repo here", not a failure worth surfacing. */
export const BENIGN_GIT_ERROR_FRAGMENTS = [
    "not a git repository",
    "could not find repository",
    ".invalid",
    "unborn",
];

/** Whether error text reports an invalid git reference. */
export const hasInvalidReference = (message: string): boolean =>
    message.includes("reference") && message.includes("not valid");

/** Errors that mean "no usable repo here", not a failure worth surfacing. */
export const isBenignGitError = (err: unknown): boolean => {
    const message = String(err).toLowerCase();
    return BENIGN_GIT_ERROR_FRAGMENTS.some((fragment) => message.includes(fragment)) || hasInvalidReference(message);
};

/** Display text for an unknown thrown value. */
export const errorText = (err: unknown): string => (err instanceof Error ? err.message : String(err));
