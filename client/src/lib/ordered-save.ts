export function createOrderedTaskQueue() {
  let tail: Promise<unknown> = Promise.resolve();
  const enqueue = <T>(task: () => Promise<T>): Promise<T> => {
    const result = tail.then(task);
    tail = result.catch(() => undefined);
    return result;
  };
  return {
    enqueue,
    flush: () => tail.then(() => undefined),
  };
}
