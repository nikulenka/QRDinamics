import React, { useState, useEffect, useRef } from "react";
import { Plus, Edit2, Trash2, QrCode as QrCodeIcon, Link as LinkIcon, Download, X, Search, BarChart2, LogOut } from "lucide-react";
import QRCode from "qrcode";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import type { Link } from "./types";
import { cn } from "./lib/utils";
import { auth, db, handleFirestoreError, OperationType } from './firebase';
import { collection, query, where, onSnapshot, addDoc, updateDoc, deleteDoc, doc, serverTimestamp, Timestamp } from 'firebase/firestore';

function QrCodeThumbnail({ url }: { url: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (canvasRef.current && url) {
      QRCode.toCanvas(canvasRef.current, url, {
        width: 100,
        margin: 1,
        color: { dark: '#4f46e5', light: '#ffffff' }
      });
    }
  }, [url]);
  return <canvas ref={canvasRef} className="rounded-xl overflow-hidden shadow-sm" />;
}

export default function Dashboard() {
  const [links, setLinks] = useState<Link[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [filterStatus, setFilterStatus] = useState<"all" | "active" | "expired">("all");
  const [isLoading, setIsLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isQrModalOpen, setQrModalOpen] = useState(false);
  const [isStatsModalOpen, setIsStatsModalOpen] = useState(false);
  const [selectedStatsLink, setSelectedStatsLink] = useState<Link | null>(null);
  const [currentLink, setCurrentLink] = useState<Link | null>(null);
  const [titleInput, setTitleInput] = useState("");
  const [destinationInput, setDestinationInput] = useState("");
  const [expiresAtInput, setExpiresAtInput] = useState("");
  const [error, setError] = useState("");
  const [selectedQrUrl, setSelectedQrUrl] = useState("");
  
  const user = auth.currentUser;

  useEffect(() => {
    if (!user) return;
    const q = query(collection(db, 'links'), where('ownerId', '==', user.uid));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const fetchedLinks: Link[] = [];
      snapshot.forEach((docSnap) => {
        const data = docSnap.data();
        fetchedLinks.push({
          id: docSnap.id,
          title: data.title,
          destination: data.destination,
          clicks: data.clicks,
          // Convert Firestore Timestamp to string for our local Link type
          createdAt: data.createdAt?.toDate?.().toISOString() || new Date().toISOString(),
          updatedAt: data.updatedAt?.toDate?.().toISOString() || new Date().toISOString(),
          expiresAt: data.expiresAt, // Assuming string ISO was stored for simplicity, wait, let's keep it consistent
        });
      });
      // Sort client side, as we didn't create a composite index yet
      fetchedLinks.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      setLinks(fetchedLinks);
      setIsLoading(false);
    }, (err) => {
      handleFirestoreError(err, OperationType.LIST, 'links');
      setIsLoading(false);
    });
    return () => unsubscribe();
  }, [user]);

  const handleSave = async () => {
    if (!destinationInput.trim()) {
      setError("Destination URL is required");
      return;
    }
    
    // basic url validation
    try {
      new URL(destinationInput);
    } catch {
      setError("Please enter a valid URL (e.g. https://example.com)");
      return;
    }

    try {
      const isEdit = !!currentLink;
      
      const payload: any = { 
        destination: destinationInput, 
        title: titleInput || "Untitled QR Code",
      };
      
      if (expiresAtInput) {
        payload.expiresAt = new Date(expiresAtInput).toISOString();
      } else {
        payload.expiresAt = null; 
      }

      if (isEdit) {
        payload.updatedAt = serverTimestamp();
        await updateDoc(doc(db, 'links', currentLink.id), payload);
      } else {
        payload.ownerId = user!.uid;
        payload.clicks = 0;
        payload.createdAt = serverTimestamp();
        payload.updatedAt = serverTimestamp();
        await addDoc(collection(db, 'links'), payload);
      }
      
      closeModal();
    } catch (err: any) {
      setError(err.message || "An error occurred");
      handleFirestoreError(err, OperationType.WRITE, 'links');
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Are you sure you want to delete this QR code?")) return;
    try {
      await deleteDoc(doc(db, 'links', id));
    } catch (err: any) {
      handleFirestoreError(err, OperationType.DELETE, `links/${id}`);
    }
  };

  const openModal = (link?: Link) => {
    setCurrentLink(link || null);
    setTitleInput(link?.title || "");
    setDestinationInput(link?.destination || "");
    if (link?.expiresAt) {
      const d = new Date(link.expiresAt);
      const localDatetime = new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
      setExpiresAtInput(localDatetime);
    } else {
      setExpiresAtInput("");
    }
    setError("");
    setIsModalOpen(true);
  };

  const closeModal = () => {
    setIsModalOpen(false);
    setCurrentLink(null);
    setTitleInput("");
    setDestinationInput("");
    setExpiresAtInput("");
  };

  const getFullQrUrl = (id: string) => {
    return `${window.location.origin}/q/${id}`;
  };

  const showQrCode = (link: Link) => {
    setSelectedQrUrl(getFullQrUrl(link.id));
    setQrModalOpen(true);
  };

  const filteredLinks = links.filter((link) => {
    const q = searchQuery.toLowerCase();
    const searchMatch = (link.title?.toLowerCase() || "").includes(q) || link.destination.toLowerCase().includes(q);
    
    let statusMatch = true;
    if (filterStatus === "active") {
      statusMatch = !link.expiresAt || new Date(link.expiresAt) >= new Date();
    } else if (filterStatus === "expired") {
      statusMatch = !!link.expiresAt && new Date(link.expiresAt) < new Date();
    }

    return searchMatch && statusMatch;
  });

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col font-sans selection:bg-indigo-100">
      
      {/* Header */}
      <header className="bg-white border-b border-gray-100 sticky top-0 z-30">
        <div className="max-w-4xl mx-auto px-6 h-20 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-indigo-600 rounded-2xl flex items-center justify-center shadow-lg shadow-indigo-200">
              <QrCodeIcon className="w-5 h-5 text-white" />
            </div>
            <h1 className="text-xl font-black tracking-tight text-gray-900">QR Command</h1>
          </div>
          
          <div className="flex items-center gap-4">
            <button
              onClick={() => auth.signOut()}
              className="text-gray-400 hover:text-gray-900 font-bold text-sm transition-colors flex items-center gap-2"
            >
              <LogOut className="w-4 h-4" />
              <span className="hidden sm:inline">Sign Out</span>
            </button>
            <button 
              onClick={() => openModal()}
              className="bg-gray-900 hover:bg-black text-white px-5 py-2.5 rounded-xl font-bold flex items-center gap-2 transition-all hover:scale-105 shadow-md hover:shadow-xl active:scale-95"
            >
              <Plus className="w-4 h-4" strokeWidth={3} />
              <span className="tracking-wide">NEW QR</span>
            </button>
          </div>
        </div>
      </header>

      <main className="flex-1 w-full max-w-4xl mx-auto p-6 md:p-10 flex flex-col gap-8">

        {/* Search & Filter */}
        {links.length > 0 && (
          <div className="flex flex-col sm:flex-row gap-4 mb-4">
            <div className="relative flex-1">
              <Search className="absolute left-5 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
              <input
                type="text"
                placeholder="Search codes by title or destination..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full bg-white border border-gray-100 rounded-2xl pl-13 pr-5 py-4 shadow-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 transition-all font-medium text-gray-900"
              />
            </div>
            <select
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value as any)}
              className="bg-white border border-gray-100 rounded-2xl px-5 py-4 shadow-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 transition-all font-bold text-gray-700 min-w-[150px] appearance-none"
              style={{ backgroundImage: "url(\"data:image/svg+xml,%3csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 20 20'%3e%3cpath stroke='%236b7280' stroke-linecap='round' stroke-linejoin='round' stroke-width='1.5' d='M6 8l4 4 4-4'/%3e%3c/svg%3e\")", backgroundPosition: "right 1rem center", backgroundRepeat: "no-repeat", backgroundSize: "1.5em 1.5em" }}
            >
              <option value="all">All Status</option>
              <option value="active">Active Only</option>
              <option value="expired">Expired Only</option>
            </select>
          </div>
        )}

        {/* Empty State / Loading */}
        {isLoading ? (
          <div className="flex-1 flex items-center justify-center">
            <div className="animate-pulse flex flex-col items-center gap-4">
              <div className="w-12 h-12 border-4 border-indigo-200 border-t-indigo-600 rounded-full animate-spin"></div>
            </div>
          </div>
        ) : filteredLinks.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center text-center max-w-sm mx-auto opacity-70">
            <div className="w-24 h-24 bg-gray-100 rounded-full flex items-center justify-center mb-6">
              <QrCodeIcon className="w-10 h-10 text-gray-400" />
            </div>
            <h2 className="text-2xl font-black text-gray-900 tracking-tight mb-2">No shortcuts found</h2>
            <p className="text-gray-500 font-medium mb-8">
              {searchQuery ? "Try adjusting your search query." : "Generate your first short link and dynamic QR code to start tracking scans."}
            </p>
          </div>
        ) : (
          /* List */
          <div className="flex flex-col gap-4">
            {filteredLinks.map((link) => (
              <div key={link.id} className="bg-white rounded-[32px] p-6 shadow-sm border border-gray-100 hover:shadow-md transition-shadow group flex flex-col md:flex-row gap-6 items-center">
                
                {/* QR Thumbnail */}
                <div 
                  onClick={() => showQrCode(link)}
                  className="shrink-0 p-2 bg-gray-50 border border-gray-100 rounded-2xl cursor-pointer hover:border-indigo-500 transition-colors group relative"
                >
                  <div className="absolute inset-0 bg-indigo-500/10 rounded-2xl opacity-0 group-hover:opacity-100 transition-opacity"></div>
                  <QrCodeThumbnail url={getFullQrUrl(link.id)} />
                </div>

                {/* Info */}
                <div className="grow min-w-0 flex flex-col gap-1 w-full text-center sm:text-left">
                  <div className="text-xl font-black text-indigo-900 truncate mb-1">
                    {link.title || "Untitled QR Code"}
                  </div>
                  <div className="font-mono text-sm text-indigo-600 bg-indigo-50 px-3 py-1.5 rounded-lg inline-flex self-center sm:self-start gap-2 items-center truncate max-w-full font-bold">
                    <LinkIcon className="w-3.5 h-3.5 shrink-0" />
                    <span className="truncate">{getFullQrUrl(link.id)}</span>
                  </div>
                  <div className="text-gray-900 font-bold truncate mt-2 text-lg">
                    {link.destination}
                  </div>
                  <div className="text-xs text-gray-400 mt-0.5 font-bold uppercase tracking-wider flex items-center justify-center sm:justify-start gap-2 flex-wrap">
                    <span>Created {new Date(link.createdAt).toLocaleDateString()}</span>
                    <span className="px-2 py-0.5 rounded text-[10px] bg-blue-50 text-blue-600">
                      Scans: {link.clicks || 0}
                    </span>
                    {link.expiresAt && (
                      <span className={cn(
                        "px-2 py-0.5 rounded text-[10px]",
                        new Date(link.expiresAt) < new Date() ? "bg-red-100 text-red-600" : "bg-orange-100 text-orange-600"
                      )}>
                        {new Date(link.expiresAt) < new Date() ? "Expired" : `Expires: ${new Date(link.expiresAt).toLocaleDateString()}`}
                      </span>
                    )}
                  </div>
                </div>

                {/* Actions */}
                <div className="flex items-center justify-center gap-2 shrink-0">
                  <button
                    onClick={() => { setSelectedStatsLink(link); setIsStatsModalOpen(true); }}
                    className="w-10 h-10 flex items-center justify-center text-orange-400 hover:text-orange-600 hover:bg-orange-50 rounded-xl transition-colors bg-orange-50/50"
                    title="View Analytics"
                  >
                    <BarChart2 className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => openModal(link)}
                    className="w-10 h-10 flex items-center justify-center text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-xl transition-colors bg-gray-50"
                    title="Edit Destination"
                  >
                    <Edit2 className="w-4 h-4" strokeWidth={2.5} />
                  </button>
                  <button
                    onClick={() => handleDelete(link.id)}
                    className="w-10 h-10 flex items-center justify-center text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-xl transition-colors bg-gray-50"
                    title="Delete Link"
                  >
                    <Trash2 className="w-4 h-4" strokeWidth={2.5} />
                  </button>
                </div>

              </div>
            ))}
          </div>
        )}
      </main>

      {/* Editor Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex flex-col items-center justify-end md:justify-center p-4">
          <div className="w-full max-w-lg bg-white rounded-[40px] shadow-2xl overflow-hidden flex flex-col md:scale-100 animate-in fade-in slide-in-from-bottom-10 duration-200">
            <div className="p-8 pb-4 flex items-center justify-between">
              <h2 className="text-2xl font-black text-gray-900 tracking-tight">
                {currentLink ? "Edit Shortcut" : "New Shortcut"}
              </h2>
              <button
                onClick={closeModal}
                className="w-10 h-10 bg-gray-50 hover:bg-gray-100 text-gray-500 rounded-2xl flex items-center justify-center transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-8 pt-4 overflow-y-auto">
              <div className="mb-6">
                <label className="block text-xs font-black text-gray-400 uppercase tracking-widest mb-2 ml-1">
                  Title (Optional)
                </label>
                <input
                  type="text"
                  autoFocus
                  className="w-full px-5 py-4 bg-gray-50 border-2 border-transparent focus:border-indigo-500 rounded-2xl outline-none font-bold text-gray-900 transition-all placeholder:text-gray-300"
                  placeholder="e.g. Summer Campaign"
                  value={titleInput}
                  onChange={(e) => setTitleInput(e.target.value)}
                />
              </div>

              <div className="mb-6">
                <label className="block text-xs font-black text-gray-400 uppercase tracking-widest mb-2 ml-1">
                  Destination URL
                </label>
                <input
                  type="url"
                  className="w-full px-5 py-4 bg-gray-50 border-2 border-transparent focus:border-indigo-500 rounded-2xl outline-none font-bold text-gray-900 transition-all font-mono placeholder:text-gray-300 placeholder:font-sans"
                  placeholder="https://yourwebsite.com/long/path"
                  value={destinationInput}
                  onChange={(e) => setDestinationInput(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleSave()}
                />
              </div>

              <div className="mb-8">
                <label className="block text-xs font-black text-gray-400 uppercase tracking-widest mb-2 ml-1">
                  Expiry Date (Optional)
                </label>
                <input
                  type="datetime-local"
                  className="w-full px-5 py-4 bg-gray-50 border-2 border-transparent focus:border-indigo-500 rounded-2xl outline-none font-bold text-gray-800 transition-all"
                  value={expiresAtInput}
                  onChange={(e) => setExpiresAtInput(e.target.value)}
                />
                <p className="mt-3 text-xs font-medium text-gray-400 ml-1">
                  If set, the QR code will stop redirecting after this date.
                </p>
              </div>

              {error && <div className="mb-6 p-4 rounded-2xl bg-red-50 text-red-600 font-bold text-sm tracking-wide">{error}</div>}

              <button
                onClick={handleSave}
                className="w-full py-5 bg-indigo-600 text-white font-black rounded-2xl shadow-xl shadow-indigo-200 hover:scale-[1.02] transition-transform text-lg"
              >
                SAVE & GENERATE QR
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Large QR Modal */}
      {isQrModalOpen && (
        <QrModal url={selectedQrUrl} onClose={() => setQrModalOpen(false)} />
      )}

      {/* Stats Modal */}
      {isStatsModalOpen && selectedStatsLink && (
        <StatsModal 
          link={selectedStatsLink} 
          onClose={() => { setIsStatsModalOpen(false); setSelectedStatsLink(null); }} 
        />
      )}

    </div>
  );
}

function QrModal({ url, onClose }: { url: string; onClose: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  
  useEffect(() => {
    if (canvasRef.current) {
      QRCode.toCanvas(canvasRef.current, url, {
        width: 320,
        margin: 2,
        color: { dark: '#000000', light: '#ffffff' }
      });
    }
  }, [url]);

  const downloadPng = () => {
    if (!canvasRef.current) return;
    const dataUrl = canvasRef.current.toDataURL("image/png");
    const a = document.createElement("a");
    a.href = dataUrl;
    a.download = "qrcode.png";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const downloadSvg = () => {
    QRCode.toString(url, { type: 'svg', margin: 2, color: { dark: '#000000', light: '#ffffff' } }, (err, string) => {
      if (err) return console.error(err);
      const blob = new Blob([string], { type: 'image/svg+xml' });
      const svgUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = svgUrl;
      a.download = "qrcode.svg";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(svgUrl);
    });
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-[#F9FAFB] rounded-[40px] border-4 border-white shadow-2xl p-10 max-w-sm w-full flex flex-col items-center gap-6" onClick={e => e.stopPropagation()}>
        <canvas ref={canvasRef} className="rounded-2xl shadow-sm border border-gray-100" />
        
        <div className="text-center w-full">
          <p className="text-sm text-gray-500">Fixed Short Link:<br/><span className="font-mono font-bold text-indigo-600 truncate block mx-auto mt-1 max-w-[280px]">{url}</span></p>
        </div>

        <div className="w-full space-y-3 mt-4 flex flex-col">
          <div className="flex gap-3">
            <button
              onClick={downloadSvg}
              className="w-full py-4 bg-white text-gray-900 font-black rounded-2xl shadow-sm border border-gray-200 hover:bg-gray-50 transition-colors flex items-center justify-center gap-2"
            >
              <Download className="w-5 h-5" strokeWidth={3} />
              SVG
            </button>
            <button
              onClick={downloadPng}
              className="w-full py-4 bg-white text-gray-900 font-black rounded-2xl shadow-sm border border-gray-200 hover:bg-gray-50 transition-colors flex items-center justify-center gap-2"
            >
              <Download className="w-5 h-5" strokeWidth={3} />
              PNG
            </button>
          </div>
          
          <button
            onClick={() => {
              navigator.clipboard.writeText(url);
              alert("Link copied!");
            }}
            className="w-full py-4 bg-indigo-600 text-white font-black rounded-2xl shadow-xl shadow-indigo-200 hover:scale-[1.02] transition-transform flex items-center justify-center gap-2 mt-2"
          >
            <LinkIcon className="w-5 h-5" strokeWidth={3} />
            COPY LINK
          </button>
        </div>
        
      </div>
    </div>
  );
}

function StatsModal({ link, onClose }: { link: Link; onClose: () => void }) {
  const dummyData = Array.from({ length: 7 }).map((_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (6 - i));
    return {
      name: d.toLocaleDateString(undefined, { weekday: 'short' }),
      scans: Math.floor(Math.random() * 50) + 10,
    };
  });

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-[40px] shadow-2xl p-8 max-w-lg w-full flex flex-col gap-6" onClick={e => e.stopPropagation()}>
        <div className="flex justify-between items-center mb-2">
          <div>
            <h2 className="text-2xl font-black text-gray-900 tracking-tight">Scan Activity</h2>
            <p className="text-sm font-bold text-gray-400 mt-1 truncate max-w-[250px]">{link.title || link.destination}</p>
          </div>
          <button onClick={onClose} className="w-10 h-10 flex items-center justify-center text-gray-400 hover:text-gray-900 rounded-xl hover:bg-gray-100 transition-all">
            <X className="w-6 h-6" />
          </button>
        </div>
        
        <div className="h-64 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={dummyData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E5E7EB" />
              <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fill: '#9CA3AF', fontSize: 12, fontWeight: 700 }} dy={10} />
              <YAxis axisLine={false} tickLine={false} tick={{ fill: '#9CA3AF', fontSize: 12, fontWeight: 700 }} />
              <Tooltip 
                contentStyle={{ borderRadius: '16px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1)', fontWeight: 'bold' }}
                cursor={{ stroke: '#E5E7EB', strokeWidth: 2 }}
              />
              <Line type="monotone" dataKey="scans" stroke="#f97316" strokeWidth={4} activeDot={{ r: 8, fill: '#f97316', stroke: '#fff', strokeWidth: 3 }} dot={{ r: 4, fill: '#f97316', strokeWidth: 0 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
