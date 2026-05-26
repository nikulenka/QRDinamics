import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { db, handleFirestoreError, OperationType } from './firebase';
import { doc, getDoc, updateDoc, increment } from 'firebase/firestore';

export default function Redirect() {
  const { id } = useParams<{ id: string }>();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    async function handleRedirect() {
      try {
        const docRef = doc(db, 'links', id!);
        const docSnap = await getDoc(docRef);
        
        if (docSnap.exists()) {
          const data = docSnap.data();
          if (data.expiresAt && new Date(data.expiresAt) < new Date()) {
            setError("This link has expired");
            return;
          }
          await updateDoc(docRef, { clicks: increment(1) }).catch(e => {
            // It's okay if purely unauthenticated write fails on increment
            console.error("Increment failed", e);
          });
          window.location.href = data.destination;
        } else {
          setError("Link not found");
        }
      } catch (err: any) {
        setError(err.message || "An error occurred");
        handleFirestoreError(err, OperationType.GET, `links/${id}`);
      }
    }
    handleRedirect();
  }, [id]);

  if (error) {
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center p-4">
        <div className="bg-white rounded-[32px] shadow-sm border border-gray-100 p-8 max-w-sm w-full text-center">
          <h1 className="text-2xl font-black text-gray-900 tracking-tight mb-2">Oops</h1>
          <p className="text-gray-500 font-medium">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="animate-pulse flex flex-col items-center gap-4">
        <div className="w-12 h-12 border-4 border-indigo-200 border-t-indigo-600 rounded-full animate-spin"></div>
        <div className="text-indigo-600 font-bold uppercase tracking-widest text-sm">Redirecting...</div>
      </div>
    </div>
  );
}
