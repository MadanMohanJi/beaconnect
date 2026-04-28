import React, { useState, useEffect, useRef, useMemo } from 'react';
import { 
  Flame, Activity, ShieldAlert, Map as MapIcon, 
  AlertTriangle, CheckCircle2, Shield, User, Navigation, 
  Clock, MapPin, Radio, Settings, LogOut, ChevronRight,
  Crosshair, Zap, Building, KeyRound, Plus, Trash2, Cpu, 
  Link as LinkIcon, Crosshair as GpsIcon, Home, WifiOff, 
  Mic, VolumeX, Volume2, Edit, UploadCloud, Layers, ImageIcon, Heart, ArrowRight
} from 'lucide-react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, collection, addDoc, onSnapshot, doc, updateDoc, deleteDoc } from 'firebase/firestore';

// --- Firebase Configuration ---
const firebaseConfig = {
  apiKey: "AIzaSyBgo3ir7Y5GSck3rIU1c3Dnlva6_RsgaVQ",
  authDomain: "beaconnect-fc92a.firebaseapp.com",
  projectId: "beaconnect-fc92a",
  storageBucket: "beaconnect-fc92a.firebasestorage.app",
  messagingSenderId: "184838138038",
  appId: "1:184838138038:web:23730f680504a020505e17",
  measurementId: "G-CP0ND459YY"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const appId = 'beaconnect'; 
const ALERTS_COLLECTION = 'alerts_v6';
const VENUES_COLLECTION = 'venues_v6';

// --- Gemini API Setup ---
const geminiApiKey = "YOUR_GEMINI_API_KEY_HERE"; // <--- PASTE YOUR GEMINI KEY HERE
const MODEL_NAME = "gemini-2.5-flash";

async function fetchWithRetry(url, options, maxRetries = 5) {
  let retries = 0;
  while (retries < maxRetries) {
    try {
      const response = await fetch(url, options);
      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
      return await response.json();
    } catch (error) {
      retries++;
      if (retries === maxRetries) throw error;
      await new Promise(resolve => setTimeout(resolve, Math.pow(2, retries) * 1000));
    }
  }
}

async function analyzeEmergency(text) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL_NAME}:generateContent?key=${geminiApiKey}`;
  const systemInstruction = `You are an advanced enterprise emergency triage AI. 
  Analyze the user's distress message. Categorize type (Fire, Medical, Security, or General). 
  Assess severity (Critical, High, Medium, Low). Provide a concise 1-sentence summary and a Spanish translation.
  Generate 2-3 short action tags (e.g., ["Bleeding", "Needs AED"]). Output strictly as JSON.`;

  const payload = {
    contents: [{ parts: [{ text }] }],
    systemInstruction: { parts: [{ text: systemInstruction }] },
    generationConfig: { responseMimeType: "application/json" }
  };

  try {
    const result = await fetchWithRetry(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    return JSON.parse(result.candidates[0].content.parts[0].text);
  } catch (err) {
    return { type: "General", severity: "High", summary: text, translation_es: "Traducción no disponible", tags: ["Unknown Context"] };
  }
}

const triggerHardwareAlarm = () => {
  if ("vibrate" in navigator) navigator.vibrate([200, 100, 200]);
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (AudioContext) {
      const ctx = new AudioContext();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine'; 
      osc.frequency.setValueAtTime(900, ctx.currentTime); 
      osc.connect(gain);
      gain.connect(ctx.destination);
      gain.gain.setValueAtTime(0, ctx.currentTime);
      gain.gain.linearRampToValueAtTime(0.5, ctx.currentTime + 0.05); 
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 1.5);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 1.5);
    }
  } catch (e) { console.warn("Audio alarm blocked"); }
};

const notifyStaff = (alert) => {
  if (!("Notification" in window)) return;
  if (Notification.permission === "granted") {
    new Notification(`EMERGENCY: ${alert.type} in ${alert.roomId}`, { body: alert.summary, icon: "https://cdn-icons-png.flaticon.com/512/595/595067.png" });
  } else if (Notification.permission !== "denied") {
    Notification.requestPermission().then(permission => { if (permission === "granted") notifyStaff(alert); });
  }
};

// --- NEW: Slide To Cancel Component ---
const SlideToCancel = ({ onCancel }) => {
  const [value, setValue] = useState(0);

  const handleChange = (e) => {
    const val = parseInt(e.target.value);
    setValue(val);
    if (val >= 98) onCancel();
  };

  const handleRelease = () => { if (value < 98) setValue(0); };

  return (
    <div className="relative w-full max-w-[250px] h-14 bg-slate-800 rounded-full overflow-hidden flex items-center justify-center border border-slate-700 shadow-inner mt-8">
      <span className="absolute text-slate-400 text-xs font-bold uppercase tracking-widest z-0 pointer-events-none">Slide to Cancel</span>
      <div className="absolute left-0 top-0 bottom-0 bg-red-500/20 pointer-events-none transition-all duration-75" style={{ width: `${value}%` }}></div>
      <input 
        type="range" min="0" max="100" value={value} 
        onChange={handleChange} onMouseUp={handleRelease} onTouchEnd={handleRelease}
        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-20"
      />
      <div className="absolute left-1 w-12 h-12 bg-slate-700 rounded-full shadow flex items-center justify-center pointer-events-none transition-all duration-75 z-10" style={{ transform: `translateX(${(value / 100) * 190}px)` }}>
        <ArrowRight size={20} className="text-slate-300" />
      </div>
    </div>
  );
};

const CountdownTimer = ({ endTime, isLoRa }) => {
  const [timeLeft, setTimeLeft] = useState(Math.max(0, Math.floor((endTime - Date.now()) / 1000)));
  useEffect(() => {
    const timer = setInterval(() => setTimeLeft(Math.max(0, Math.floor((endTime - Date.now()) / 1000))), 1000);
    return () => clearInterval(timer);
  }, [endTime]);

  return (
    <div className="text-right shrink-0">
      <div className="text-2xl md:text-4xl font-light text-white">{Math.floor(timeLeft / 60)}:{(timeLeft % 60).toString().padStart(2, '0')}</div>
      <div className={`text-[8px] md:text-[10px] font-bold uppercase tracking-widest ${isLoRa ? 'text-purple-400' : 'text-red-400'}`}>Est. Arrival</div>
    </div>
  );
};

export default function App() {
  const [user, setUser] = useState(null);
  const [alerts, setAlerts] = useState([]);
  const [venues, setVenues] = useState([]);
  
  const [currentRole, setCurrentRole] = useState('portal');
  const [activeVenue, setActiveVenue] = useState(null);
  
  const [guestRoomId, setGuestRoomId] = useState('');
  const [customText, setCustomText] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [useLoraMesh, setUseLoraMesh] = useState(false);
  const [isRecording, setIsRecording] = useState(false);

  const [activeResponderAlert, setActiveResponderAlert] = useState(null);
  const [responderEndTime, setResponderEndTime] = useState(Date.now() + 180000);
  const [mapMode, setMapMode] = useState('satellite');

  const [mutedAlerts, setMutedAlerts] = useState([]);
  const prevAlertCountRef = useRef(0);

  useEffect(() => {
    const initAuth = async () => { try { await signInAnonymously(auth); } catch (err) { console.error("Auth error:", err); } };
    initAuth();
    const unsubscribe = onAuthStateChanged(auth, setUser);
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (currentRole === 'guest' && activeVenue) {
      const savedRoom = localStorage.getItem(`beaconnet_room_${activeVenue.id}`);
      if (savedRoom && activeVenue.rooms?.includes(savedRoom)) setGuestRoomId(savedRoom);
    }
  }, [currentRole, activeVenue]);

  const handleRoomChange = (e) => {
    const room = e.target.value;
    setGuestRoomId(room);
    localStorage.setItem(`beaconnet_room_${activeVenue.id}`, room);
  };

  useEffect(() => {
    if (!user) return;
    const venuesRef = collection(db, 'artifacts', appId, 'public', 'data', VENUES_COLLECTION);
    const unsubVenues = onSnapshot(venuesRef, (snapshot) => {
      const fetchedVenues = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setVenues(fetchedVenues);
      if (activeVenue) {
        const updated = fetchedVenues.find(v => v.id === activeVenue.id);
        if (updated) setActiveVenue(updated);
      }
    });

    const alertsRef = collection(db, 'artifacts', appId, 'public', 'data', ALERTS_COLLECTION);
    const unsubAlerts = onSnapshot(alertsRef, (snapshot) => {
      const fetchedAlerts = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      fetchedAlerts.sort((a, b) => b.timestamp - a.timestamp);
      setAlerts(fetchedAlerts);

      const activeAlerts = fetchedAlerts.filter(a => a.status === 'active' && a.venueId === activeVenue?.id);
      if ((currentRole === 'staff' || currentRole === 'responder') && activeAlerts.length > prevAlertCountRef.current) {
         notifyStaff(activeAlerts[0]);
         if (!mutedAlerts.includes(activeAlerts[0].id)) triggerHardwareAlarm();
      }
      prevAlertCountRef.current = activeAlerts.length;

      if (activeResponderAlert) {
        const updatedResponderAlert = fetchedAlerts.find(a => a.id === activeResponderAlert.id);
        if (updatedResponderAlert) setActiveResponderAlert(updatedResponderAlert);
      }
    });

    return () => { unsubVenues(); unsubAlerts(); };
  }, [user, activeVenue?.id, activeResponderAlert?.id, currentRole, mutedAlerts]);

  useEffect(() => {
    let alarmInterval;
    const activeUnmutedAlerts = alerts.filter(a => a.status === 'active' && a.venueId === activeVenue?.id && !mutedAlerts.includes(a.id));
    if ((currentRole === 'staff' || currentRole === 'responder') && activeUnmutedAlerts.length > 0) {
      alarmInterval = setInterval(triggerHardwareAlarm, 4000);
    }
    return () => clearInterval(alarmInterval);
  }, [currentRole, alerts, activeVenue?.id, mutedAlerts]);

  const toggleMute = (alertId) => { setMutedAlerts(prev => prev.includes(alertId) ? prev.filter(id => id !== alertId) : [...prev, alertId]); };

  const handleLogout = () => {
    setCurrentRole('portal');
    setActiveVenue(null);
    setGuestRoomId('');
    setActiveResponderAlert(null);
    setMapMode('satellite');
  };

  const triggerAlert = async (type, isCustom = false, sourceOverride = null, overrideRoom = null) => {
    const targetVenue = activeVenue;
    const targetRoom = overrideRoom || guestRoomId;
    if (!user || !targetVenue || !targetRoom) return;
    setIsSubmitting(true);

    let finalSource = sourceOverride;
    let networkMethod = 'Wi-Fi / Cellular';
    if (!finalSource) {
       if (useLoraMesh) { finalSource = "Resident App (LoRa Offline Node)"; networkMethod = "LoRa Radio Mesh"; } 
       else { finalSource = targetVenue.venueType === 'neighborhood' ? 'Resident Mobile App' : 'Guest Mobile App'; }
    } else if (sourceOverride?.includes('LoRa')) { networkMethod = "LoRa Radio Mesh"; }

    let alertData = {
      venueId: targetVenue.id, roomId: targetRoom, type, status: 'active', timestamp: Date.now(),
      source: finalSource, network: networkMethod, severity: type === 'Fire' ? 'Critical' : type === 'Medical' ? 'Critical' : 'High',
      summary: `Automated ${type} protocol initiated for ${targetRoom} via ${finalSource}.`, translation_es: `Protocolo de ${type} automático iniciado.`,
      tags: [type.toUpperCase(), 'IMMEDIATE RESPONSE', finalSource.includes('IoT') ? 'HARDWARE' : 'HUMAN'],
      responderLink: `B-NET-${Math.random().toString(36).substring(2, 8).toUpperCase()}`
    };

    if (isCustom && customText) {
      const aiAnalysis = await analyzeEmergency(customText);
      alertData = { ...alertData, ...aiAnalysis, originalText: customText, source: 'App + AI' };
    }

    try {
      await addDoc(collection(db, 'artifacts', appId, 'public', 'data', ALERTS_COLLECTION), alertData);
      setCustomText(''); setUseLoraMesh(false); 
    } catch (err) { console.error(err); } finally { setIsSubmitting(false); }
  };

  const resolveAlert = async (alertId) => {
    if (!user) return;
    try {
      await updateDoc(doc(db, 'artifacts', appId, 'public', 'data', ALERTS_COLLECTION, alertId), { status: 'resolved', resolvedAt: Date.now() });
      if (activeResponderAlert?.id === alertId) { setActiveResponderAlert(null); setCurrentRole('staff'); }
    } catch (err) { console.error(err); }
  };

  const handleVoiceInput = () => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) return alert("Your browser does not support Voice-to-Text.");
    const recognition = new SpeechRecognition();
    recognition.onstart = () => setIsRecording(true);
    recognition.onresult = (e) => setCustomText(e.results[0][0].transcript);
    recognition.onerror = () => setIsRecording(false);
    recognition.onend = () => setIsRecording(false);
    recognition.start();
  };

  // --- 1. Portal / Login Screen ---
  const Portal = () => {
    const [accessCode, setAccessCode] = useState('');
    const [staffPin, setStaffPin] = useState('');
    const [loginType, setLoginType] = useState('guest'); 
    const [error, setError] = useState('');

    const handleLogin = () => {
      setError('');
      if (venues.length === 0 && loginType !== 'admin') return setError('Database is empty! Please click "Seed Demo Data" below first.');

      if (loginType === 'guest') {
        const venue = venues.find(v => v.code.toUpperCase() === accessCode.toUpperCase());
        if (venue) { setActiveVenue(venue); setCurrentRole('guest'); } else { setError('Invalid Access Code.'); }
      } else if (loginType === 'staff' || loginType === 'responder') {
        if (staffPin === '1234') {
          const venue = venues.find(v => v.code.toUpperCase() === accessCode.toUpperCase());
          if (venue) { setActiveVenue(venue); setCurrentRole(loginType); } else { setError('Venue code required.'); }
        } else { setError('Invalid PIN. Use "1234".'); }
      } else if (loginType === 'admin') {
        if (staffPin === '9999') {
          if (venues.length > 0) setActiveVenue(venues[0]);
          setCurrentRole('admin');
        } else { setError('Invalid Admin PIN. Use "9999".'); }
      }
    };

    const seedDemoVenues = async () => {
      try {
        const demoVenues = [
          { name: "Grand Horizon Resort", venueType: "resort", code: "VEGAS24", lat: "36.112634", lng: "-115.176746", rooms: ["301","302","303","304"], floorplanUrl: "" },
          { name: "Oak Creek Neighborhood", venueType: "neighborhood", code: "OAKCREEK", lat: "34.0522", lng: "-118.2437", rooms: ["142 Maple St", "144 Maple St"], floorplanUrl: "" }
        ];
        for (const v of demoVenues) { await addDoc(collection(db, 'artifacts', appId, 'public', 'data', VENUES_COLLECTION), v); }
        alert("Success! Demo Data has been injected.");
      } catch (err) { setError("Failed to seed data."); }
    };

    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 to-slate-800 flex flex-col items-center justify-center p-6 text-slate-200">
        <div className="w-full max-w-md bg-slate-800/80 backdrop-blur-xl rounded-[2rem] p-8 shadow-2xl border border-slate-700/50 relative">
          {venues.length === 0 && (<div className="absolute -top-12 left-0 right-0 bg-yellow-500 text-yellow-900 font-bold p-2 rounded-lg text-center text-xs animate-bounce">⚠️ NEW DATABASE - CLICK "SEED DEMO DATA" ⚠️</div>)}
          <div className="flex flex-col items-center mb-8">
            <div className="bg-gradient-to-br from-blue-500 to-blue-700 p-4 rounded-2xl mb-4 shadow-[0_0_30px_rgba(37,99,235,0.4)]"><Zap size={32} className="text-white" /></div>
            <h1 className="text-3xl font-black text-white tracking-tight">BeaconNet</h1>
          </div>
          <div className="flex gap-2 bg-slate-900/50 p-1.5 rounded-xl mb-6">
            <button onClick={() => setLoginType('guest')} className={`flex-1 py-2 text-sm font-bold rounded-lg ${loginType === 'guest' ? 'bg-blue-600 text-white' : 'text-slate-500'}`}>Citizen</button>
            <button onClick={() => setLoginType('staff')} className={`flex-1 py-2 text-sm font-bold rounded-lg ${loginType === 'staff' ? 'bg-blue-600 text-white' : 'text-slate-500'}`}>Command</button>
            <button onClick={() => setLoginType('admin')} className={`flex-1 py-2 text-sm font-bold rounded-lg ${loginType === 'admin' ? 'bg-blue-600 text-white' : 'text-slate-500'}`}>Admin</button>
          </div>
          <div className="space-y-4">
            {loginType !== 'admin' && (
              <div><input type="text" value={accessCode} onChange={e => setAccessCode(e.target.value.toUpperCase())} placeholder="Zone Code (e.g. VEGAS24)" className="w-full bg-slate-900/50 border border-slate-700 rounded-xl py-3.5 px-4 text-white font-mono" /></div>
            )}
            {(loginType === 'staff' || loginType === 'admin') && (
              <div><input type="password" value={staffPin} onChange={e => setStaffPin(e.target.value)} placeholder="Security PIN" className="w-full bg-slate-900/50 border border-slate-700 rounded-xl py-3.5 px-4 text-white" /></div>
            )}
            {error && <div className="text-red-400 text-sm">{error}</div>}
            <button onClick={handleLogin} className="w-full bg-blue-600 text-white font-bold py-3.5 rounded-xl mt-4">Connect to Mesh</button>
          </div>
          {venues.length === 0 && <button onClick={seedDemoVenues} className="w-full mt-6 bg-emerald-600 text-white font-bold py-3.5 rounded-xl">Seed Demo Data</button>}
        </div>
      </div>
    );
  };

  // --- 2. Admin Settings View ---
  const AdminSettings = () => {
    const [formData, setFormData] = useState({ name: '', venueType: 'resort', code: '', lat: '', lng: '', roomsStr: '', floorplanUrl: '' });
    const [editingVenueId, setEditingVenueId] = useState(null);
    const [isLocating, setIsLocating] = useState(false);
    
    // NEW: Visual Pin Drop Interaction
    const handleImageClick = (e) => {
      // Simulate dropping a pin and asking for room name
      const roomName = window.prompt("Enter a Zone or Room Name for this location:");
      if (roomName) {
        setFormData(prev => ({
          ...prev,
          roomsStr: prev.roomsStr ? prev.roomsStr + '\n' + roomName : roomName
        }));
      }
    };

    useEffect(() => { if (venues.length > 0 && !activeVenue) setActiveVenue(venues[0]); }, [venues]);

    const handleSave = async (e) => {
      e.preventDefault();
      const roomsArray = formData.roomsStr.split(/[\n,]+/).map(s => s.trim()).filter(s => s);
      const payload = { name: formData.name, venueType: formData.venueType, code: formData.code.toUpperCase(), lat: formData.lat, lng: formData.lng, floorplanUrl: formData.floorplanUrl, rooms: roomsArray };
      
      try {
        if (editingVenueId) await updateDoc(doc(db, 'artifacts', appId, 'public', 'data', VENUES_COLLECTION, editingVenueId), payload);
        else await addDoc(collection(db, 'artifacts', appId, 'public', 'data', VENUES_COLLECTION), payload);
        setFormData({ name: '', venueType: 'resort', code: '', lat: '', lng: '', roomsStr: '', floorplanUrl: '' }); setEditingVenueId(null);
        alert("Success!");
      } catch(err) { alert("Error: " + err.message); }
    };

    const handleEdit = (venue) => {
      setFormData({ name: venue.name, venueType: venue.venueType, code: venue.code, lat: venue.lat, lng: venue.lng, floorplanUrl: venue.floorplanUrl || '', roomsStr: venue.rooms.join(',\n') });
      setEditingVenueId(venue.id); window.scrollTo({ top: 0, behavior: 'smooth' });
    };

    return (
      <div className="min-h-screen bg-slate-50 p-4 md:p-8 overflow-y-auto font-sans">
         <div className="max-w-5xl mx-auto">
            <div className="flex justify-between items-center mb-8 bg-white p-4 rounded-2xl shadow-sm border border-slate-200">
               <h1 className="text-2xl font-black text-slate-900 flex items-center gap-3"><Zap className="text-blue-600"/> Platform Admin</h1>
               <button onClick={handleLogout} className="flex items-center gap-2 bg-red-50 text-red-600 px-5 py-2.5 rounded-xl font-bold hover:bg-red-600 hover:text-white transition-all"><LogOut size={18}/> Logout</button>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
               <div className="bg-white p-6 md:p-8 rounded-3xl shadow-sm border border-slate-200">
                  <div className="flex justify-between items-center mb-6">
                    <h2 className="text-xl font-bold flex items-center gap-2 text-slate-800">Deploy Infrastructure</h2>
                    {editingVenueId && <button type="button" onClick={() => setEditingVenueId(null)} className="text-xs font-bold text-slate-400 hover:text-slate-600">Cancel Edit</button>}
                  </div>

                  <form onSubmit={handleSave} className="space-y-5">
                     <div className="flex gap-4">
                         <div className="flex-1"><input required type="text" value={formData.name} onChange={e=>setFormData({...formData, name: e.target.value})} className="w-full p-3 bg-slate-50 border rounded-xl" placeholder="Zone Name" /></div>
                         <div className="flex-1"><input required type="text" value={formData.code} disabled={!!editingVenueId} onChange={e=>setFormData({...formData, code: e.target.value.toUpperCase()})} className="w-full p-3 bg-slate-50 border rounded-xl font-mono uppercase disabled:opacity-50" placeholder="CODE" /></div>
                     </div>
                     
                     <div className="flex gap-4">
                            <div className="flex-1"><input required type="text" value={formData.lat} onChange={e=>setFormData({...formData, lat: e.target.value})} className="w-full p-3 bg-slate-50 border rounded-xl text-sm" placeholder="Latitude" /></div>
                            <div className="flex-1"><input required type="text" value={formData.lng} onChange={e=>setFormData({...formData, lng: e.target.value})} className="w-full p-3 bg-slate-50 border rounded-xl text-sm" placeholder="Longitude" /></div>
                     </div>

                     <div>
                        <label className="block text-xs font-bold text-slate-500 uppercase mb-1.5">Floor Plan Image URL</label>
                        <input type="url" value={formData.floorplanUrl} onChange={e=>setFormData({...formData, floorplanUrl: e.target.value})} className="w-full p-3 bg-slate-50 border rounded-xl text-sm" placeholder="https://..." />
                     </div>

                     {/* Visual Drag-and-Drop Setup Simulation */}
                     {formData.floorplanUrl && (
                        <div className="bg-slate-100 border-2 border-dashed border-slate-300 rounded-xl p-2 text-center relative overflow-hidden group cursor-pointer" onClick={handleImageClick} title="Click to add a room zone!">
                           <img src={formData.floorplanUrl} alt="Preview" className="max-h-[150px] mx-auto opacity-70 group-hover:opacity-100 transition-opacity" />
                           <div className="absolute inset-0 bg-blue-900/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                              <span className="bg-blue-600 text-white px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1"><MapPin size={14}/> Click to map new zone</span>
                           </div>
                        </div>
                     )}

                     <div>
                       <label className="block text-xs font-bold text-slate-500 uppercase mb-1.5">Zone List</label>
                       <textarea required value={formData.roomsStr} onChange={e=>setFormData({...formData, roomsStr: e.target.value})} className="w-full p-3 bg-slate-50 border rounded-xl text-sm" rows={5}></textarea>
                     </div>
                     <button type="submit" className="w-full bg-slate-900 text-white font-bold py-4 rounded-xl hover:bg-blue-600">Save</button>
                  </form>
               </div>

               <div className="space-y-6">
                  <div>
                      <h2 className="text-xl font-bold mb-4 flex items-center gap-2 text-slate-800"><Building size={22} className="text-slate-500"/> Active Networks</h2>
                      {venues.map(v => (
                        <div key={v.id} className="bg-white p-5 rounded-2xl shadow-sm border border-slate-200 mb-3">
                            <div className="flex justify-between items-center">
                              <div>
                                <h3 className="font-bold text-lg">{v.name}</h3>
                                <span className="bg-slate-100 text-slate-600 text-xs font-mono font-bold px-2 py-1 rounded-md">{v.code}</span>
                              </div>
                              <div className="flex gap-2">
                                <button onClick={() => handleEdit(v)} className="text-blue-500 p-2"><Edit size={20}/></button>
                                <button onClick={() => deleteDoc(doc(db, 'artifacts', appId, 'public', 'data', VENUES_COLLECTION, v.id))} className="text-red-500 p-2"><Trash2 size={20}/></button>
                              </div>
                            </div>
                        </div>
                      ))}
                  </div>
               </div>
            </div>
         </div>
      </div>
    );
  };

  // --- 3. Guest/Resident Interface ---
  const GuestInterface = () => {
    // NEW: Language detection dictionary
    const isSpanish = navigator.language.startsWith('es');
    const isHindi = navigator.language.startsWith('hi');
    const uiText = {
      med: isSpanish ? 'SOS Médico' : isHindi ? 'मेडिकल इमरजेंसी' : 'Medical SOS',
      fire: isSpanish ? 'Incendio/Inundación' : isHindi ? 'आग / बाढ़' : 'Fire / Flood',
      sec: isSpanish ? 'Amenaza de Seguridad' : isHindi ? 'सुरक्षा खतरा' : 'Security Threat',
      desc1: isSpanish ? 'Lesión, enfermedad' : isHindi ? 'चोट, बीमारी' : 'Injury, illness, distress',
      desc2: isSpanish ? 'Evacuación requerida' : isHindi ? 'निकासी आवश्यक' : 'Evacuation required',
      desc3: isSpanish ? 'Peligro físico' : isHindi ? 'शारीरिक खतरा' : 'Intruder, physical danger',
    };

    const currentRoomAlert = alerts.find(a => a.venueId === activeVenue.id && a.roomId === guestRoomId && a.status === 'active');

    // NEW: Calming UI for Medical
    if (currentRoomAlert) {
      const isMedical = currentRoomAlert.type === 'Medical';
      
      return (
        <div className={`flex flex-col items-center justify-center min-h-screen w-full p-6 text-center text-white overflow-hidden font-sans transition-colors duration-1000 ${isMedical ? 'bg-slate-900' : 'bg-slate-900'}`}>
          
          {isMedical ? (
            // Breathe With Me Animation
            <div className="relative mb-12 mt-4 flex items-center justify-center">
               <div className="absolute w-48 h-48 bg-blue-500/20 rounded-full animate-[ping_4s_cubic-bezier(0.4,0,0.6,1)_infinite]"></div>
               <div className="absolute w-36 h-36 bg-blue-500/40 rounded-full animate-[ping_4s_cubic-bezier(0.4,0,0.6,1)_infinite] animation-delay-1000"></div>
               <div className="bg-gradient-to-br from-blue-400 to-blue-600 p-8 rounded-full shadow-[0_0_50px_rgba(59,130,246,0.6)] z-10 relative">
                 <Heart size={48} className="text-white animate-pulse" />
               </div>
            </div>
          ) : (
            // Standard Panic UI
            <div className="relative mb-8 mt-4">
               <div className="absolute inset-0 bg-red-500 rounded-full animate-ping opacity-20 scale-150"></div>
               <div className="bg-gradient-to-br from-red-500 to-red-700 p-8 rounded-full shadow-[0_0_50px_rgba(220,38,38,0.6)] z-10 relative"><Radio size={48} className="animate-pulse text-white" /></div>
            </div>
          )}

          <h2 className="text-3xl md:text-4xl font-black mb-2 tracking-tight">SOS Transmitting</h2>
          
          {isMedical ? (
             <p className="text-blue-200 mb-8 max-w-sm text-lg font-medium">Help is routing to <span className="text-white font-bold">{guestRoomId}</span>.<br/><br/><span className="text-blue-400 font-bold">Breathe in sync with the circle.</span></p>
          ) : (
             <p className="text-slate-300 mb-8 max-w-sm text-lg font-medium">Response teams are routing to <span className="text-white font-bold block mt-1">{guestRoomId}</span></p>
          )}
          
          {/* Slider replaces the accidental-click button */}
          <div className="mt-auto mb-12 w-full flex justify-center">
             <SlideToCancel onCancel={() => resolveAlert(currentRoomAlert.id)} />
          </div>
        </div>
      );
    }

    return (
      <div className="w-full h-full bg-slate-100 overflow-y-auto font-sans">
        <div className="max-w-md mx-auto min-h-full bg-white shadow-2xl flex flex-col relative">
          <div className="p-6 md:p-8 text-center shrink-0 bg-white sticky top-0 z-20 shadow-sm">
            <div className="flex justify-between items-start mb-4">
               <div className="inline-flex items-center px-3 py-1.5 bg-blue-50 rounded-xl border border-blue-100">
                 <Zap className="text-blue-600 mr-1.5" size={16} /><span className="font-bold text-xs tracking-tight text-blue-900">BeaconNet Node</span>
               </div>
               <button onClick={handleLogout} className="text-slate-400 hover:text-red-500 bg-slate-50 p-2 rounded-lg"><LogOut size={18}/></button>
            </div>
            <h1 className="text-3xl font-black text-slate-900 mb-2 tracking-tight">{activeVenue.name}</h1>
            <div className="mt-4 flex items-center justify-center bg-slate-50 p-3 rounded-xl border border-slate-200">
              <MapPin size={16} className="text-slate-400 mr-2"/>
              <select value={guestRoomId} onChange={handleRoomChange} className="bg-transparent text-slate-800 text-sm font-bold outline-none cursor-pointer w-full appearance-none truncate">
                <option value="" disabled>Select Location...</option>
                {activeVenue.rooms?.map(id => <option key={id} value={id}>{id}</option>)}
              </select>
            </div>
          </div>

          <div className="flex-grow px-6 py-6 space-y-4 bg-slate-50/50">
            <button onClick={() => triggerAlert('Medical')} disabled={!guestRoomId || isSubmitting} className="group w-full bg-white border border-slate-200 rounded-[2rem] p-4 flex items-center gap-4 shadow-sm hover:border-red-400">
              <div className="bg-red-50 text-red-600 p-4 rounded-[1.5rem] shrink-0"><Activity size={28} /></div>
              <div className="text-left flex-grow">
                <h2 className="text-xl font-black text-slate-800">{uiText.med}</h2>
                <p className="text-slate-500 text-xs font-medium">{uiText.desc1}</p>
              </div>
            </button>

            <button onClick={() => triggerAlert('Fire')} disabled={!guestRoomId || isSubmitting} className="group w-full bg-white border border-slate-200 rounded-[2rem] p-4 flex items-center gap-4 shadow-sm hover:border-orange-400">
              <div className="bg-orange-50 text-orange-600 p-4 rounded-[1.5rem] shrink-0"><Flame size={28} /></div>
              <div className="text-left flex-grow">
                <h2 className="text-xl font-black text-slate-800">{uiText.fire}</h2>
                <p className="text-slate-500 text-xs font-medium">{uiText.desc2}</p>
              </div>
            </button>

            <button onClick={() => triggerAlert('Security')} disabled={!guestRoomId || isSubmitting} className="group w-full bg-white border border-slate-200 rounded-[2rem] p-4 flex items-center gap-4 shadow-sm hover:border-blue-400">
              <div className="bg-blue-50 text-blue-600 p-4 rounded-[1.5rem] shrink-0"><ShieldAlert size={28} /></div>
              <div className="text-left flex-grow">
                <h2 className="text-xl font-black text-slate-800">{uiText.sec}</h2>
                <p className="text-slate-500 text-xs font-medium">{uiText.desc3}</p>
              </div>
            </button>

            <div className="bg-white p-5 rounded-[2rem] border border-slate-200 mt-8 shadow-sm">
              <label className="block text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-3 ml-1"><Zap size={12} className="inline text-blue-500"/> Custom Alert</label>
              <div className="flex gap-2 bg-slate-50 p-1.5 rounded-[1.5rem] border border-slate-200 items-center">
                <button onClick={handleVoiceInput} className={`p-2 rounded-full ${isRecording ? 'bg-red-500 text-white animate-pulse' : 'bg-slate-200 text-slate-500'}`}><Mic size={18} /></button>
                <input type="text" value={customText} onChange={(e) => setCustomText(e.target.value)} placeholder="Describe..." className="flex-grow p-2 text-sm bg-transparent outline-none" disabled={isSubmitting} />
                <button onClick={() => triggerAlert('Custom', true)} disabled={isSubmitting || !customText.trim() || !guestRoomId} className="bg-slate-900 text-white px-5 py-2.5 rounded-[1.2rem] text-sm font-bold">Send</button>
              </div>
            </div>
            <div className="h-12 w-full"></div>
          </div>
        </div>
      </div>
    );
  };

  // --- 4. Staff/Community Dashboard ---
  const StaffDashboard = () => {
    const venueAlerts = alerts.filter(a => a.venueId === activeVenue.id && a.status === 'active');
    const isRedAlert = venueAlerts.length > 0;

    return (
      <div className="flex flex-col md:flex-row h-full w-full bg-slate-50 overflow-hidden font-sans">
        {isRedAlert && <div className="absolute inset-0 border-[6px] border-red-500 pointer-events-none z-50 animate-pulse"></div>}

        <div className="md:hidden w-full bg-slate-900 text-white p-4 flex justify-between items-center z-20"><Zap className="text-blue-500" size={20} /><button onClick={handleLogout}><LogOut size={14} /></button></div>
        <div className="hidden md:flex w-24 bg-slate-900 flex-col items-center py-6 z-20"><div className="bg-blue-600 p-3.5 rounded-2xl mb-8"><Zap className="text-white" size={28} /></div></div>

        <div className="w-full md:w-[480px] bg-white border-r flex flex-col h-[50vh] md:h-full z-10 shadow-xl">
          <div className="hidden md:flex justify-between p-4 border-b bg-slate-50"><div className="text-xs font-bold text-slate-500"><Building size={14} className="inline mr-1"/> {activeVenue.name}</div><button onClick={handleLogout} className="text-xs font-bold text-slate-600"><LogOut size={14}/> LOGOUT</button></div>
          <div className={`p-5 md:p-6 border-b ${isRedAlert ? 'bg-red-600 text-white' : 'bg-white'}`}><h1 className="text-2xl md:text-3xl font-black">Active Incidents</h1></div>
          
          <div className="flex-grow overflow-y-auto bg-slate-50/50 p-4 space-y-4">
            {venueAlerts.length === 0 && <div className="text-center text-slate-400 py-12">All systems secure.</div>}

            {venueAlerts.map(alert => {
              const isMuted = mutedAlerts.includes(alert.id);
              return (
              <div key={alert.id} className={`bg-white p-5 rounded-[1.5rem] shadow-sm border ${isMuted ? 'border-slate-200 opacity-80' : 'border-red-300'}`}>
                <div className="flex justify-between items-start mb-4">
                  <div className="flex items-center gap-3">
                    <div className={`p-3 rounded-2xl text-white ${alert.severity === 'Critical' ? 'bg-red-500' : 'bg-orange-500'}`}>{alert.type === 'Medical' ? <Activity size={24} /> : <AlertTriangle size={24}/>}</div>
                    <div className="min-w-0"><h3 className="font-black text-lg">{alert.roomId}</h3><p className="text-xs text-slate-500">{new Date(alert.timestamp).toLocaleTimeString()}</p></div>
                  </div>
                  <div className="flex flex-col items-end gap-2">
                    <span className="text-[10px] font-black px-2 py-1 rounded bg-red-50 text-red-700">{alert.severity}</span>
                    {isMuted && <span className="text-[9px] font-bold text-slate-400"><VolumeX size={10}/> Muted</span>}
                  </div>
                </div>
                <div className="bg-slate-50 p-4 rounded-2xl mb-4"><p className="text-sm font-semibold">{alert.summary}</p></div>
                <div className="flex gap-2">
                  <button onClick={() => { setCurrentRole('responder'); setActiveResponderAlert(alert); setResponderEndTime(Date.now() + 180000); }} className="flex-1 bg-slate-900 text-white py-2.5 rounded-xl text-xs font-bold">Tactical UI</button>
                  <button onClick={() => toggleMute(alert.id)} className={`px-4 py-2.5 rounded-xl border ${isMuted ? 'bg-blue-50 text-blue-600' : 'bg-slate-100 text-slate-600'}`}>{isMuted ? <Volume2 size={16}/> : <VolumeX size={16}/>}</button>
                  <button onClick={() => resolveAlert(alert.id)} className="px-5 bg-white border py-2.5 rounded-xl text-xs font-bold">Clear</button>
                </div>
              </div>
            )})}
          </div>
        </div>
        <div className="flex-grow p-4 flex flex-col h-[50vh] md:h-full bg-slate-100">
          <div className="w-full h-full bg-white rounded-3xl border shadow-sm flex items-center justify-center p-4">
             <div className="flex flex-wrap justify-center gap-4">
                {activeVenue.rooms?.map(rId => {
                  const isAlert = venueAlerts.some(a => a.roomId === rId);
                  return (
                     <div key={rId} className={`flex flex-col items-center justify-center border-2 rounded-2xl p-4 w-28 h-28 ${isAlert ? 'border-red-500 bg-red-50 animate-pulse' : 'border-slate-200'}`}>
                        <span className={`font-black text-center text-xs truncate w-full ${isAlert ? 'text-red-700 text-lg' : 'text-slate-500'}`} title={rId}>{rId}</span>
                     </div>
                  )
                })}
             </div>
          </div>
        </div>
      </div>
    );
  };

  // --- 5. Tactical / Responder HUD ---
  const ResponderView = () => {
    if (!activeResponderAlert) return <div className="h-full bg-black text-slate-400 flex items-center justify-center"><button onClick={() => setCurrentRole('staff')} className="px-6 py-2 border rounded">RETURN TO COMMAND</button></div>;

    const isLoRa = activeResponderAlert.network === 'LoRa Radio Mesh';
    
    const memoizedMap = useMemo(() => {
       if (mapMode === 'floorplan') {
         return (
           <div className="flex-grow relative flex bg-[#0f172a] overflow-hidden items-center justify-center">
              {activeVenue.floorplanUrl ? (
                 <div className="relative w-full h-full p-4 flex items-center justify-center">
                   <img src={activeVenue.floorplanUrl} alt="Floorplan" className="max-w-full max-h-full object-contain opacity-80" />
                   <div className="absolute flex flex-col items-center justify-center z-10">
                     <div className="w-20 h-20 border-2 border-red-500 rounded-full absolute animate-ping"></div>
                     <div className="w-4 h-4 bg-red-500 rounded-full z-10"></div>
                   </div>
                 </div>
              ) : (
                 <div className="text-blue-500/50 font-bold">NO FLOORPLAN UPLOADED</div>
              )}
           </div>
         );
       }
       const mapUrl = `https://maps.google.com/maps?q=$${activeVenue.lat},${activeVenue.lng}&t=k&z=19&output=embed`;
       return (
         <div className="flex-grow relative flex bg-black">
            <iframe src={mapUrl} className="absolute inset-0 w-full h-full opacity-80" style={{ filter: "sepia(20%) hue-rotate(180deg) saturate(150%) brightness(80%)" }} allowFullScreen="" loading="lazy"></iframe>
         </div>
       );
    }, [activeVenue.lat, activeVenue.lng, activeVenue.floorplanUrl, activeResponderAlert.roomId, mapMode]);

    return (
      <div className="bg-[#0a0f16] h-full w-full text-slate-300 flex flex-col font-mono overflow-hidden">
        <div className={`border-b p-3 flex justify-between items-center shadow-lg ${isLoRa ? 'bg-purple-900/20 border-purple-500/30' : 'bg-red-900/20 border-red-500/30'}`}>
          <div className="font-black text-xl text-red-500 tracking-widest uppercase">TACTICAL UPLINK</div>
          <div className="flex gap-4 items-center">
             <CountdownTimer endTime={responderEndTime} isLoRa={isLoRa} />
             <button onClick={handleLogout} className="bg-slate-800 p-3 rounded-lg text-slate-400 hover:text-white"><LogOut size={20}/></button>
          </div>
        </div>

        <div className="p-4 flex-grow flex flex-col lg:flex-row gap-4 w-full">
          <div className="w-full lg:w-1/3 flex flex-col gap-4">
            <div className="bg-slate-900/80 p-6 border border-slate-800 rounded-2xl shadow-2xl">
              <h3 className="text-red-500 text-xs uppercase font-bold mb-3">Target Location</h3>
              <div className="text-4xl font-black text-white mb-2 leading-none">{activeResponderAlert.roomId}</div>
              <div className="text-sm font-bold text-slate-400 mb-6 mt-2">{activeVenue.name}</div>
              <div className="bg-black/50 p-4 rounded-xl border border-slate-800 text-slate-200">
                <p className="text-sm font-medium">{activeResponderAlert.summary}</p>
              </div>
            </div>
          </div>

          <div className="w-full lg:w-2/3 bg-slate-900/80 border border-slate-800 rounded-2xl flex flex-col shadow-2xl overflow-hidden">
            <div className="p-3 border-b border-slate-800 flex justify-between items-center bg-black/80">
              <div className="flex gap-2">
                 <button onClick={() => setMapMode('satellite')} className={`text-xs font-bold px-3 py-1.5 rounded ${mapMode === 'satellite' ? 'bg-slate-700 text-white' : 'text-slate-500'}`}>Satellite</button>
                 <button onClick={() => setMapMode('floorplan')} className={`text-xs font-bold px-3 py-1.5 rounded ${mapMode === 'floorplan' ? 'bg-slate-700 text-white' : 'text-slate-500'}`}>Floor Plan</button>
              </div>
            </div>
            {memoizedMap}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="h-screen w-full bg-slate-900 text-slate-900 flex flex-col overflow-hidden selection:bg-blue-500/30">
      {currentRole === 'portal' && <Portal />}
      {currentRole === 'admin' && <AdminSettings />}
      {currentRole === 'guest' && <GuestInterface />}
      {currentRole === 'staff' && <StaffDashboard />}
      {currentRole === 'responder' && <ResponderView />}
    </div>
  );
}