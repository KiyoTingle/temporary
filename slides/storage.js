export function openStorage() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('assembly-slide-studio', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('documents');
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('別のタブを閉じてから再度お試しください。'));
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => db.close();
      resolve({
        load() {
          return new Promise((done, fail) => {
            const tx = db.transaction('documents');
            const read = tx.objectStore('documents').get('working');
            tx.oncomplete = () => done(read.result);
            tx.onerror = () => fail(tx.error);
            tx.onabort = () => fail(tx.error || new Error('読み込みが中断されました。'));
          });
        },
        save(value) {
          return new Promise((done, fail) => {
            const tx = db.transaction('documents', 'readwrite');
            tx.objectStore('documents').put(value, 'working');
            tx.oncomplete = () => done();
            tx.onerror = () => fail(tx.error);
            tx.onabort = () => fail(tx.error || new Error('保存が中断されました。'));
          });
        }
      });
    };
  });
}
