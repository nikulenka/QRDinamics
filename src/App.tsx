import React, { useEffect, useState } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import { onAuthStateChanged } from "firebase/auth";
import { auth } from "./firebase";
import AuthScreen from "./Auth";
import Dashboard from "./Dashboard";
import RedirectScreen from "./Redirect";

export default function App() {
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="w-12 h-12 border-4 border-indigo-200 border-t-indigo-600 rounded-full animate-spin"></div>
      </div>
    );
  }

  return (
    <Routes>
      <Route path="/q/:id" element={<RedirectScreen />} />
      <Route path="/" element={
        user ? <Dashboard /> : <Navigate to="/login" replace />
      } />
      <Route path="/login" element={
        user ? <Navigate to="/" replace /> : <AuthScreen />
      } />
    </Routes>
  );
}
