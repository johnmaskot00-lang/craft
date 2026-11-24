export function resolveActiveFileCode(input: {
  activeFile: string;
  streamedFile: string;
  streamedCode: string;
  optimisticCode: string;
  projectCode: string;
  fileCode: string;
}): string {
  if (input.streamedFile === input.activeFile && input.streamedCode) return input.streamedCode;
  if (input.optimisticCode) return input.optimisticCode;
  if (input.activeFile === "index.html") return input.projectCode || "";
  return input.fileCode || "";
}

export async function retryOnceAfterConflict<TInitial, TRetry = TInitial>(
  initialResponse: TInitial,
  options: {
    isConflict: (response: TInitial) => boolean | Promise<boolean>;
    waitForIdle: () => Promise<boolean>;
    request: () => Promise<TRetry>;
  },
): Promise<{ response: TInitial | TRetry; retried: boolean; timedOut: boolean }> {
  if (!(await options.isConflict(initialResponse))) {
    return { response: initialResponse, retried: false, timedOut: false };
  }
  if (!(await options.waitForIdle())) {
    return { response: initialResponse, retried: false, timedOut: true };
  }
  return { response: await options.request(), retried: true, timedOut: false };
}
