import { set, get, del} from 'idb-keyval';

export async function saveImageOffline(id, file) {
  alert('🎉 saveImageOffline called with id: ' + id);
  try {
    if (!(file instanceof Blob)) {
      console.error('❌ Not a Blob:', file);
      return;
    }

    if (file.size === 0) {
      console.error('❌ Blob has size 0 — skipping save');
      return;
    }

    await set(id, file);

    // Immediate read-back check
    const test = await get(id);
    console.log('🔁 Saved + Retrieved Blob:', test);
    console.log('🧾 Type:', test?.type, '📏 Size:', test?.size);

  } catch (err) {
    console.error('❌ Failed to save image to IndexedDB:', err);
  }
}

export async function saveImage(file) {
  const id = `${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
  await saveImageOffline(id, file);
  return id;
}

export async function deleteImageO(id) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('image-store');
    request.onerror = () => reject('❌ Failed to open IndexedDB');
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction('keyval-store', 'readwrite');
      const store = tx.objectStore('keyval-store');
      const deleteReq = store.delete(id);
      deleteReq.onsuccess = () => resolve();
      deleteReq.onerror = () => reject('❌ Failed to delete image ID: ' + id);
    };
  });
}


export async function deleteImage(id) {
  try {
    await del(id);
    console.log(`🗑️ Deleted image from IndexedDB: ${id}`);
  } catch (err) {
    console.error('❌ Failed to delete image from IndexedDB:', err);
  }
}

// Load image blob by ID
export async function getImage(id) {
  try {
    return await get(id);
  } catch (err) {
    console.error('❌ Failed to get image from IndexedDB:', err);
    return null;
  }
}
