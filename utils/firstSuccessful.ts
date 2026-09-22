// Equivalent to Promise.any without requiring Safari 14's Promise.any API.
// Every rejection is handled; an early failed source does not hide a later success.
export function firstSuccessful<T>(tasks: Promise<T>[]): Promise<T> {
  return new Promise((resolve, reject) => {
    let remaining = tasks.length;
    if (!remaining) { reject(new Error('No sources')); return; }
    tasks.forEach(task => task.then(resolve, error => {
      if (--remaining === 0) reject(error);
    }));
  });
}
