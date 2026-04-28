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
import { getStorage, ref, uploadBytes, getDownloadURL } from 'firebase/storage';
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
const storage = getStorage(app); // NEW: Initialize Storage
const appId = 'beaconnect'; 
const ALERTS_COLLECTION = 'alerts_v6';
const VENUES_COLLECTION = 'venues_v6';

// --- Gemini API Setup ---
// --- Gemini API Setup ---
// Pulls securely from your hidden .env file!
const geminiApiKey = import.meta.env.VITE_GEMINI_API_KEY; 
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
    if (!SpeechRecognition) return alert("Your browser does not support Voice-to-Text. Please type your message.");
    const recognition = new SpeechRecognition();
    recognition.onstart = () => setIsRecording(true);
    recognition.onresult = (e) => setCustomText(e.results[0][0].transcript);
    recognition.onerror = () => setIsRecording(false);
    recognition.onend = () => setIsRecording(false);
    recognition.start();
  };

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
          {venues.length === 0 && (<div className="absolute -top-12 left-0 right-0 bg-yellow-500 text-yellow-900 font-bold p-2 rounded-lg text-center text-xs animate-bounce shadow-lg">⚠️ NEW DATABASE - CLICK "SEED DEMO DATA" ⚠️</div>)}
          <div className="flex flex-col items-center mb-8">
            <div className="bg-gradient-to-br from-blue-500 to-blue-700 p-4 rounded-2xl mb-4 shadow-[0_0_30px_rgba(37,99,235,0.4)]"><Zap size={32} className="text-white" /></div>
            <h1 className="text-3xl font-black text-white tracking-tight">BeaconNet</h1>
            <p className="text-slate-400 text-sm font-medium mt-1">Unified Emergency Mesh</p>
          </div>
          <div className="flex gap-2 bg-slate-900/50 p-1.5 rounded-xl mb-6 border border-slate-700/50">
            <button onClick={() => {setLoginType('guest'); setError('');}} className={`flex-1 py-2 text-sm font-bold rounded-lg transition-all ${loginType === 'guest' ? 'bg-blue-600 text-white shadow-md' : 'text-slate-500 hover:text-slate-300'}`}>Citizen</button>
            <button onClick={() => {setLoginType('staff'); setError('');}} className={`flex-1 py-2 text-sm font-bold rounded-lg transition-all ${loginType === 'staff' ? 'bg-blue-600 text-white shadow-md' : 'text-slate-500 hover:text-slate-300'}`}>Command</button>
            <button onClick={() => {setLoginType('admin'); setError('');}} className={`flex-1 py-2 text-sm font-bold rounded-lg transition-all ${loginType === 'admin' ? 'bg-blue-600 text-white shadow-md' : 'text-slate-500 hover:text-slate-300'}`}>Admin</button>
          </div>
          <div className="space-y-4">
            {loginType !== 'admin' && (
              <div>
                <div className="mt-1 relative group">
                  <Building size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500 transition-colors" />
                  <input type="text" value={accessCode} onChange={e => setAccessCode(e.target.value.toUpperCase())} placeholder="Zone Code (e.g. VEGAS24)" className="w-full bg-slate-900/50 border border-slate-700 rounded-xl py-3.5 pl-12 pr-4 text-white uppercase font-mono outline-none focus:border-blue-500 transition-all" />
                </div>
              </div>
            )}
            {(loginType === 'staff' || loginType === 'admin') && (
              <div>
                <div className="mt-1 relative group">
                  <KeyRound size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500 transition-colors" />
                  <input type="password" value={staffPin} onChange={e => setStaffPin(e.target.value)} placeholder={loginType === 'admin' ? "Admin PIN: 9999" : "Staff PIN: 1234"} className="w-full bg-slate-900/50 border border-slate-700 rounded-xl py-3.5 pl-12 pr-4 text-white outline-none focus:border-blue-500 transition-all" />
                </div>
              </div>
            )}
            {error && <div className="text-red-400 text-sm font-medium bg-red-900/20 p-3.5 rounded-xl border border-red-500/30 flex items-start gap-2"><AlertTriangle size={18} className="shrink-0 mt-0.5" /> {error}</div>}
            <button onClick={handleLogin} className="w-full bg-blue-600 hover:bg-blue-500 active:scale-[0.98] text-white font-bold py-3.5 rounded-xl mt-4 transition-all shadow-lg flex justify-center items-center gap-2">
               Connect to Mesh <ChevronRight size={18} />
            </button>
          </div>
          {venues.length === 0 && <button onClick={seedDemoVenues} className="w-full mt-6 bg-emerald-600 hover:bg-emerald-500 text-white font-bold py-3.5 rounded-xl transition-all shadow-lg">1. Seed Demo Data to Firebase</button>}
        </div>
      </div>
    );
  };

  const AdminSettings = () => {
    const [formData, setFormData] = useState({ name: '', venueType: 'resort', code: '', lat: '', lng: '', roomsStr: '', floorplanUrl: '' });
    const [editingVenueId, setEditingVenueId] = useState(null);
    const [isLocating, setIsLocating] = useState(false);
    const [isUploadingImg, setIsUploadingImg] = useState(false); // NEW STATE FOR UPLOAD
    
    const [iotRoom, setIotRoom] = useState(activeVenue?.rooms?.[0] || '');
    const [iotType, setIotType] = useState('Fire');
    const [iotDevice, setIotDevice] = useState('LoRa Smart Smoke Detector');

    const [baseName, setBaseName] = useState('');
    const [subZoneInput, setSubZoneInput] = useState('Kitchen, Master Bedroom, Living Room, Guest Bath');

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

    // --- UPDATED: Bulletproof Image Upload ---
    const handleImageUpload = async (e) => {
      const file = e.target.files[0];
      if (!file) return;

      setIsUploadingImg(true);
      try {
        console.log("1. Starting upload to Firebase...");
        const fileRef = ref(storage, `floorplans/${Date.now()}_${file.name}`);
        
        // Using standard uploadBytes for a faster, guaranteed completion
        await uploadBytes(fileRef, file);
        console.log("2. Upload complete! Fetching URL...");
        
        const downloadURL = await getDownloadURL(fileRef);
        console.log("3. Success! URL is:", downloadURL);
        
        setFormData(prev => ({ ...prev, floorplanUrl: downloadURL }));
      } catch (error) {
        console.error("Upload error details:", error);
        alert("Upload failed! Press F12 to see the exact error in the console.");
      } finally {
        setIsUploadingImg(false);
        e.target.value = null; // Clears the input so you can select the same file again if needed
      }
    };

    const handleCSVUpload = (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (evt) => setFormData(prev => ({...prev, roomsStr: evt.target.result}));
      reader.readAsText(file);
    };

    const handleImageClick = () => {
      const roomName = window.prompt("Enter a Zone Name for this pin drop location:");
      if (roomName) setFormData(prev => ({ ...prev, roomsStr: prev.roomsStr ? prev.roomsStr + '\n' + roomName : roomName }));
    };

    const handleGenerateZones = () => {
       if (!baseName.trim()) return alert("Enter a Base Address first.");
       if (!subZoneInput.trim()) return alert("Enter sub-zones.");
       const subs = subZoneInput.split(',').map(s => s.trim()).filter(s => s);
       const generatedText = subs.map(sub => `${baseName.trim()} - ${sub}`).join('\n');
       setFormData(prev => ({ ...prev, roomsStr: prev.roomsStr ? prev.roomsStr + '\n' + generatedText : generatedText }));
       setBaseName(''); 
    };

    const handleAutoDetectGPS = (e) => {
        e.preventDefault();
        if ("geolocation" in navigator) {
            setIsLocating(true);
            navigator.geolocation.getCurrentPosition(
                (position) => { setFormData(prev => ({...prev, lat: position.coords.latitude.toFixed(6), lng: position.coords.longitude.toFixed(6)})); setIsLocating(false); },
                (error) => { alert("GPS Error. Ensure permissions are granted."); setIsLocating(false); },
                { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 } 
            );
        } else { alert("GPS Geolocation is not supported by your browser."); }
    };

    return (
      <div className="min-h-screen bg-slate-50 p-4 md:p-8 overflow-y-auto font-sans">
         <div className="max-w-5xl mx-auto">
            <div className="flex justify-between items-center mb-8 bg-white p-4 rounded-2xl shadow-sm border border-slate-200">
               <h1 className="text-2xl font-black text-slate-900 flex items-center gap-3"><Zap className="text-blue-600"/> Platform Admin</h1>
               <button onClick={handleLogout} className="flex items-center gap-2 bg-red-50 text-red-600 px-5 py-2.5 rounded-xl font-bold hover:bg-red-600 hover:text-white transition-all active:scale-95"><LogOut size={18}/> Logout</button>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
               <div className="bg-white p-6 md:p-8 rounded-3xl shadow-sm border border-slate-200">
                  <div className="flex justify-between items-center mb-6">
                    <h2 className="text-xl font-bold flex items-center gap-2 text-slate-800">
                      {editingVenueId ? <><Edit size={22} className="text-blue-500"/> Edit Infrastructure</> : <><Plus size={22} className="text-blue-500"/> Deploy Infrastructure</>}
                    </h2>
                    {editingVenueId && <button type="button" onClick={() => {setEditingVenueId(null); setFormData({ name: '', venueType: 'resort', code: '', lat: '', lng: '', roomsStr: '', floorplanUrl: '' })}} className="text-xs font-bold text-slate-400 hover:text-slate-600">Cancel Edit</button>}
                  </div>

                  <form onSubmit={handleSave} className="space-y-5">
                     <div className="flex gap-4">
                         <div className="flex-1">
                           <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5">Type</label>
                           <select value={formData.venueType} onChange={e=>setFormData({...formData, venueType: e.target.value})} className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-blue-500 font-medium">
                               <option value="resort">Hospitality / Resort</option>
                               <option value="neighborhood">Residential / Municipality</option>
                           </select>
                         </div>
                         <div className="flex-1">
                           <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5">Zone Name</label>
                           <input required type="text" value={formData.name} onChange={e=>setFormData({...formData, name: e.target.value})} className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-blue-500 font-medium" placeholder="e.g. Oak Creek" />
                         </div>
                     </div>
                     
                     <div className="flex flex-col gap-4 md:flex-row">
                         <div className="w-full md:w-1/3">
                           <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5">Access Code</label>
                           <input required type="text" value={formData.code} disabled={!!editingVenueId} onChange={e=>setFormData({...formData, code: e.target.value.toUpperCase()})} className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-blue-500 font-mono text-sm uppercase tracking-widest disabled:opacity-50" placeholder="OAKCREEK" />
                         </div>
                         
                         {/* --- NEW: Image Upload Field --- */}
                         <div className="flex-1">
                           <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5">Floor Plan Image</label>
                           <div className="relative flex items-center gap-3">
                             <input type="file" accept="image/*" onChange={handleImageUpload} className="hidden" id="floorplan-upload" />
                             <label htmlFor="floorplan-upload" className={`cursor-pointer px-4 py-3 w-full bg-blue-50 text-blue-600 font-bold rounded-xl border border-blue-200 hover:bg-blue-100 transition-colors flex items-center justify-center gap-2 ${isUploadingImg ? 'opacity-50 pointer-events-none' : ''}`}>
                                {isUploadingImg ? <div className="w-4 h-4 border-2 border-blue-600/30 border-t-blue-600 rounded-full animate-spin" /> : <UploadCloud size={18} />}
                                {isUploadingImg ? 'Uploading...' : 'Upload from Gallery'}
                             </label>
                           </div>
                         </div>
                     </div>

                     {/* Image Preview Window */}
                     {formData.floorplanUrl && (
                        <div className="bg-slate-100 border-2 border-dashed border-slate-300 rounded-xl p-2 text-center relative overflow-hidden group cursor-pointer" onClick={handleImageClick} title="Click to add a room zone!">
                           <img src={formData.floorplanUrl} alt="Preview" className="max-h-[150px] mx-auto opacity-70 group-hover:opacity-100 transition-opacity" />
                           <div className="absolute inset-0 bg-blue-900/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                              <span className="bg-blue-600 text-white px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1"><MapPin size={14}/> Click to map new zone</span>
                           </div>
                        </div>
                     )}
                     
                     <div className="bg-blue-50/50 p-4 rounded-2xl border border-blue-100">
                        <div className="flex justify-between items-center mb-3">
                           <label className="block text-xs font-bold text-slate-600 uppercase tracking-wider">Geographic Bounds</label>
                           <button onClick={handleAutoDetectGPS} type="button" className="text-xs bg-blue-600 text-white px-3 py-1.5 rounded-lg flex items-center gap-1.5 hover:bg-blue-700 active:scale-95 transition-all font-bold shadow-sm">
                              {isLocating ? <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin"/> : <GpsIcon size={14}/>} Auto-Detect
                           </button>
                        </div>
                        <div className="flex gap-4">
                            <div className="flex-1"><input required type="text" value={formData.lat} onChange={e=>setFormData({...formData, lat: e.target.value})} className="w-full p-3 bg-white border border-slate-200 rounded-xl text-sm font-mono outline-none focus:border-blue-500" placeholder="Lat (e.g. 36.112)" /></div>
                            <div className="flex-1"><input required type="text" value={formData.lng} onChange={e=>setFormData({...formData, lng: e.target.value})} className="w-full p-3 bg-white border border-slate-200 rounded-xl text-sm font-mono outline-none focus:border-blue-500" placeholder="Lng (e.g. -115.176)" /></div>
                        </div>
                     </div>

                     <div className="bg-indigo-50/50 p-4 rounded-2xl border border-indigo-100">
                        <label className="block text-xs font-bold text-indigo-700 uppercase tracking-wider mb-2 flex items-center gap-1.5"><Layers size={14}/> Smart Sub-Zone Generator</label>
                        <p className="text-[10px] text-indigo-500 mb-3">Instantly generate multiple sub-rooms for a single building or address.</p>
                        <div className="space-y-3">
                           <div><input type="text" value={baseName} onChange={e => setBaseName(e.target.value)} className="w-full p-2.5 bg-white border border-indigo-200 rounded-lg outline-none focus:border-indigo-400 text-sm" placeholder="Base Address (e.g., Tower A - Apt 102)" /></div>
                           <div><input type="text" value={subZoneInput} onChange={e => setSubZoneInput(e.target.value)} className="w-full p-2.5 bg-white border border-indigo-200 rounded-lg outline-none focus:border-indigo-400 text-sm" placeholder="Comma separated sub-zones" /></div>
                           <button type="button" onClick={handleGenerateZones} className="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-2 rounded-lg text-sm shadow-sm">Generate & Add to List ↓</button>
                        </div>
                     </div>

                     <div>
                       <div className="flex justify-between items-center mb-1.5">
                         <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider">Final Zone List</label>
                         <div className="relative">
                           <input type="file" accept=".csv,.txt" onChange={handleCSVUpload} className="absolute inset-0 w-full h-full opacity-0 cursor-pointer" />
                           <button type="button" className="text-xs text-blue-600 bg-blue-50 hover:bg-blue-100 px-2 py-1 rounded font-bold flex items-center gap-1 pointer-events-none"><UploadCloud size={14}/> Bulk Upload CSV</button>
                         </div>
                       </div>
                       <textarea required value={formData.roomsStr} onChange={e=>setFormData({...formData, roomsStr: e.target.value})} className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:border-blue-500 text-sm leading-relaxed" placeholder="Final output will appear here..." rows={6}></textarea>
                     </div>
                     <button type="submit" className="w-full bg-slate-900 text-white font-bold py-4 rounded-xl hover:bg-blue-600 shadow-md">
                       {editingVenueId ? 'Update Infrastructure' : 'Initialize Deployment'}
                     </button>
                  </form>
               </div>

               <div className="space-y-6">
                  <div className="bg-gradient-to-br from-slate-900 to-slate-800 p-6 md:p-8 rounded-3xl shadow-xl border border-slate-700 text-slate-200 relative overflow-hidden">
                      <div className="absolute top-0 right-0 p-4 opacity-5 pointer-events-none"><Cpu size={120} /></div>
                      <h2 className="text-xl font-bold mb-6 flex items-center gap-2 text-white relative z-10"><Cpu size={22} className="text-blue-400"/> Hardware Simulator</h2>
                      {activeVenue ? (
                        <div className="space-y-5 relative z-10">
                            <div className="flex gap-4">
                                <div className="flex-1">
                                    <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5">Target Point</label>
                                    <select value={iotRoom} onChange={e => setIotRoom(e.target.value)} className="w-full bg-slate-800/80 backdrop-blur border border-slate-600 rounded-xl p-3 text-white outline-none focus:border-blue-500 text-sm">
                                        {activeVenue.rooms?.map(r => <option key={r} value={r}>{r}</option>)}
                                    </select>
                                </div>
                                <div className="flex-1">
                                    <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5">Sensor Type</label>
                                    <select value={iotType} onChange={e => setIotType(e.target.value)} className="w-full bg-slate-800/80 backdrop-blur border border-slate-600 rounded-xl p-3 text-white outline-none focus:border-blue-500 text-sm">
                                        <option value="Fire">Fire / Flood</option>
                                        <option value="Security">Security / Panic</option>
                                        <option value="Medical">Medical Emergency</option>
                                    </select>
                                </div>
                            </div>
                            <div>
                                <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5">Network Node</label>
                                <select value={iotDevice} onChange={e => setIotDevice(e.target.value)} className="w-full bg-slate-800/80 backdrop-blur border border-slate-600 rounded-xl p-3 text-white outline-none focus:border-blue-500 text-sm">
                                    <option>LoRa Basement Flood Sensor</option>
                                    <option>LoRa Smart Smoke Detector</option>
                                    <option>Offline LoRa Panic Button</option>
                                </select>
                            </div>
                            <button onClick={() => triggerAlert(iotType, false, `IoT Sensor (${iotDevice})`, iotRoom)} disabled={isSubmitting} className="w-full bg-blue-600 hover:bg-blue-500 text-white font-bold py-3.5 rounded-xl flex items-center justify-center shadow-[0_0_20px_rgba(37,99,235,0.3)]">
                                {isSubmitting ? 'Transmitting...' : 'Trigger Hardware Fault'}
                            </button>
                        </div>
                      ) : <div className="text-yellow-400 text-sm font-medium bg-yellow-900/30 p-4 rounded-xl border border-yellow-700/50">Deploy an infrastructure block first to use the simulator.</div>}
                  </div>

                  <div>
                      <h2 className="text-xl font-bold mb-4 flex items-center gap-2 text-slate-800"><Building size={22} className="text-slate-500"/> Active Networks</h2>
                      {venues.map(v => (
                        <div key={v.id} className="bg-white p-5 rounded-2xl shadow-sm border border-slate-200 mb-3 group hover:border-blue-300">
                            <div className="flex justify-between items-center">
                              <div>
                                <h3 className="font-bold text-lg text-slate-900 flex items-center gap-2">{v.venueType === 'neighborhood' ? <Home size={18} className="text-slate-400" /> : <Building size={18} className="text-slate-400" />} {v.name}</h3>
                                <div className="flex items-center gap-3 mt-1.5">
                                  <span className="bg-slate-100 text-slate-600 text-xs font-mono font-bold px-2 py-1 rounded-md border border-slate-200">CODE: {v.code}</span>
                                  <span className="text-xs text-slate-400 flex items-center gap-1"><MapPin size={12}/> {v.rooms?.length || 0} Zones</span>
                                </div>
                              </div>
                              <div className="flex gap-2">
                                <button onClick={() => handleEdit(v)} title="Edit Infrastructure" className="text-slate-400 hover:text-blue-600 hover:bg-blue-50 p-2.5 rounded-xl"><Edit size={20}/></button>
                                <button onClick={() => deleteDoc(doc(db, 'artifacts', appId, 'public', 'data', VENUES_COLLECTION, v.id))} title="Delete Infrastructure" className="text-slate-400 hover:text-red-600 hover:bg-red-50 p-2.5 rounded-xl"><Trash2 size={20}/></button>
                              </div>
                            </div>
                        </div>
                      ))}
                      {venues.length === 0 && <div className="text-center p-8 bg-white rounded-2xl border border-slate-200 text-slate-400 text-sm">No networks deployed yet.</div>}
                  </div>
               </div>
            </div>
         </div>
      </div>
    );
  };

  // --- 3. Guest/Resident Interface ---
  const GuestInterface = () => {
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
    const isNeighborhood = activeVenue.venueType === 'neighborhood';
    const [isScanningBLE, setIsScanningBLE] = useState(false);

    const simulateBLEScan = () => {
      setIsScanningBLE(true);
      setTimeout(() => {
        if (activeVenue.rooms && activeVenue.rooms.length > 0) {
          const randomIndex = Math.floor(Math.random() * activeVenue.rooms.length);
          const foundRoom = activeVenue.rooms[randomIndex];
          setGuestRoomId(foundRoom);
          localStorage.setItem(`beaconnet_room_${activeVenue.id}`, foundRoom);
        }
        setIsScanningBLE(false);
      }, 2000);
    };

    if (currentRoomAlert) {
      const isMedical = currentRoomAlert.type === 'Medical';
      return (
        <div className={`flex flex-col items-center justify-center min-h-screen w-full p-6 text-center text-white overflow-hidden font-sans transition-colors duration-1000 ${isMedical ? 'bg-slate-900' : 'bg-slate-900'}`}>
          {isMedical ? (
            <div className="relative mb-12 mt-4 flex items-center justify-center">
               <div className="absolute w-48 h-48 bg-blue-500/20 rounded-full animate-[ping_4s_cubic-bezier(0.4,0,0.6,1)_infinite]"></div>
               <div className="absolute w-36 h-36 bg-blue-500/40 rounded-full animate-[ping_4s_cubic-bezier(0.4,0,0.6,1)_infinite] animation-delay-1000"></div>
               <div className="bg-gradient-to-br from-blue-400 to-blue-600 p-8 rounded-full shadow-[0_0_50px_rgba(59,130,246,0.6)] z-10 relative">
                 <Heart size={48} className="text-white animate-pulse" />
               </div>
            </div>
          ) : (
            <div className="relative mb-8 mt-4">
               <div className="absolute inset-0 bg-red-500 rounded-full animate-ping opacity-20 scale-150"></div>
               <div className="bg-gradient-to-br from-red-500 to-red-700 p-8 rounded-full shadow-[0_0_50px_rgba(220,38,38,0.6)] z-10 relative border border-red-400/50"><Radio size={48} className="animate-pulse text-white" /></div>
            </div>
          )}

          <h2 className="text-3xl md:text-4xl font-black mb-2 tracking-tight">SOS Transmitting</h2>
          {isMedical ? (
             <p className="text-blue-200 mb-8 max-w-sm text-lg font-medium">Help is routing to <span className="text-white font-bold">{guestRoomId}</span>.<br/><br/><span className="text-blue-400 font-bold">Breathe in sync with the circle.</span></p>
          ) : (
             <p className="text-slate-300 mb-8 max-w-sm text-lg font-medium">Response teams are routing to <span className="text-white font-bold block mt-1">{guestRoomId}</span></p>
          )}
          <div className="mt-auto mb-12 w-full flex justify-center"><SlideToCancel onCancel={() => resolveAlert(currentRoomAlert.id)} /></div>
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
               <button onClick={handleLogout} className="text-slate-400 hover:text-red-500 bg-slate-50 hover:bg-red-50 p-2 rounded-lg active:scale-95"><LogOut size={18}/></button>
            </div>
            <h1 className="text-3xl font-black text-slate-900 mb-2 tracking-tight">{activeVenue.name}</h1>
            <div className="mt-4 bg-slate-50 rounded-xl border border-slate-200 overflow-hidden group focus-within:border-blue-400 transition-colors">
              <div className="flex items-center p-1.5">
                <button onClick={simulateBLEScan} disabled={isScanningBLE} className={`shrink-0 p-2.5 rounded-lg flex items-center justify-center transition-all ${isScanningBLE ? 'bg-blue-100 text-blue-600' : 'bg-white text-slate-400 hover:bg-blue-50 hover:text-blue-600 border border-slate-200 shadow-sm active:scale-95'}`} title="Auto-Detect Location via BLE Beacons">
                  {isScanningBLE ? <div className="w-4 h-4 border-2 border-blue-600/30 border-t-blue-600 rounded-full animate-spin" /> : <Crosshair size={18} />}
                </button>
                <select value={guestRoomId} onChange={handleRoomChange} disabled={isScanningBLE} className="bg-transparent text-slate-800 text-sm font-bold outline-none cursor-pointer w-full text-center appearance-none px-3 disabled:opacity-50">
                  <option value="" disabled>{isScanningBLE ? 'Triangulating position...' : (isNeighborhood ? 'Select Your Address...' : 'Select Your Zone...')}</option>
                  {activeVenue.rooms?.map(id => <option key={id} value={id}>{id}</option>)}
                </select>
                {guestRoomId && !isScanningBLE && <CheckCircle2 size={18} className="text-emerald-500 shrink-0 mr-2 opacity-70" />}
              </div>
            </div>
            {isScanningBLE && <p className="text-[9px] text-blue-500 font-bold uppercase tracking-widest mt-2 animate-pulse">Scanning local BLE mesh...</p>}
          </div>

          <div className="flex-grow px-6 py-6 space-y-4 bg-slate-50/50">
            <div className="bg-gradient-to-r from-purple-50 to-indigo-50 border border-purple-100 p-4 rounded-3xl flex items-center justify-between shadow-sm mb-4">
              <div className="flex items-center gap-3">
                 <div className={`p-2.5 rounded-2xl transition-colors ${useLoraMesh ? 'bg-purple-600 text-white shadow-lg shadow-purple-600/30' : 'bg-white text-purple-400 border border-purple-100'}`}><WifiOff size={20} /></div>
                 <div><h3 className="font-bold text-purple-900 text-sm">Internet Down?</h3><p className="text-[10px] text-purple-600 font-semibold uppercase tracking-wider mt-0.5">Simulate LoRa Mesh</p></div>
              </div>
              <label className="relative inline-flex items-center cursor-pointer active:scale-95 transition-transform">
                <input type="checkbox" className="sr-only peer" checked={useLoraMesh} onChange={() => setUseLoraMesh(!useLoraMesh)} />
                <div className="w-12 h-6 bg-purple-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-purple-600"></div>
              </label>
            </div>

            <button onClick={() => triggerAlert('Medical')} disabled={!guestRoomId || isSubmitting} className="group w-full bg-white hover:bg-red-50 border border-slate-200 hover:border-red-400 rounded-[2rem] p-4 flex items-center gap-4 transition-all shadow-sm hover:shadow-md disabled:opacity-50 active:scale-[0.98]">
              <div className="bg-red-50 text-red-600 group-hover:bg-red-600 group-hover:text-white transition-colors p-4 rounded-[1.5rem] shrink-0"><Activity size={28} /></div>
              <div className="text-left flex-grow"><h2 className="text-xl font-black text-slate-800">{uiText.med}</h2><p className="text-slate-500 text-xs font-medium mt-0.5">{uiText.desc1}</p></div>
              <ChevronRight size={24} className="text-slate-300 group-hover:text-red-500 shrink-0 mr-2 transition-transform group-hover:translate-x-1" />
            </button>

            <button onClick={() => triggerAlert('Fire')} disabled={!guestRoomId || isSubmitting} className="group w-full bg-white hover:bg-orange-50 border border-slate-200 hover:border-orange-400 rounded-[2rem] p-4 flex items-center gap-4 transition-all shadow-sm hover:shadow-md disabled:opacity-50 active:scale-[0.98]">
              <div className="bg-orange-50 text-orange-600 group-hover:bg-orange-600 group-hover:text-white transition-colors p-4 rounded-[1.5rem] shrink-0"><Flame size={28} /></div>
              <div className="text-left flex-grow"><h2 className="text-xl font-black text-slate-800">{uiText.fire}</h2><p className="text-slate-500 text-xs font-medium mt-0.5">{uiText.desc2}</p></div>
              <ChevronRight size={24} className="text-slate-300 group-hover:text-orange-500 shrink-0 mr-2 transition-transform group-hover:translate-x-1" />
            </button>

            <button onClick={() => triggerAlert('Security')} disabled={!guestRoomId || isSubmitting} className="group w-full bg-white hover:bg-blue-50 border border-slate-200 hover:border-blue-400 rounded-[2rem] p-4 flex items-center gap-4 transition-all shadow-sm hover:shadow-md disabled:opacity-50 active:scale-[0.98]">
              <div className="bg-blue-50 text-blue-600 group-hover:bg-blue-600 group-hover:text-white transition-colors p-4 rounded-[1.5rem] shrink-0"><ShieldAlert size={28} /></div>
              <div className="text-left flex-grow"><h2 className="text-xl font-black text-slate-800">{uiText.sec}</h2><p className="text-slate-500 text-xs font-medium mt-0.5">{uiText.desc3}</p></div>
              <ChevronRight size={24} className="text-slate-300 group-hover:text-blue-500 shrink-0 mr-2 transition-transform group-hover:translate-x-1" />
            </button>

            <div className="bg-white p-5 rounded-[2rem] border border-slate-200 mt-8 shadow-sm">
              <label className="block text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-3 ml-1 flex items-center gap-1.5"><Zap size={12} className="text-blue-500"/> Custom AI Alert</label>
              <div className="flex gap-2 bg-slate-50 p-1.5 rounded-[1.5rem] border border-slate-200 focus-within:border-blue-400 focus-within:ring-2 focus-within:ring-blue-100 items-center">
                <button onClick={handleVoiceInput} className={`p-2 rounded-full transition-colors shrink-0 ${isRecording ? 'bg-red-500 text-white animate-pulse' : 'bg-slate-200 text-slate-500 hover:bg-blue-100 hover:text-blue-600'}`}><Mic size={18} /></button>
                <input type="text" value={customText} onChange={(e) => setCustomText(e.target.value)} placeholder="Speak or type..." className="flex-grow p-2 text-sm font-medium bg-transparent text-slate-800 outline-none min-w-0" disabled={isSubmitting} />
                <button onClick={() => triggerAlert('Custom', true)} disabled={isSubmitting || !customText.trim() || !guestRoomId} className="bg-slate-900 text-white px-5 py-2.5 rounded-[1.2rem] text-sm font-bold hover:bg-blue-600 disabled:opacity-50 active:scale-95 shrink-0 flex items-center justify-center min-w-[80px]">{isSubmitting ? <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin mx-auto" /> : 'Send'}</button>
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
    const isNeighborhood = activeVenue.venueType === 'neighborhood';

    return (
      <div className="flex flex-col md:flex-row h-full w-full bg-slate-50 overflow-hidden font-sans">
        {isRedAlert && <div className="absolute inset-0 border-[6px] border-red-500 pointer-events-none z-50 animate-pulse"></div>}
        <div className="md:hidden w-full bg-slate-900 text-white p-4 flex justify-between items-center shrink-0 z-20 shadow-lg">
          <div className="flex items-center gap-2 font-black text-lg"><Zap className="text-blue-500" size={20} /> Command</div>
          <button onClick={handleLogout} className="text-white hover:text-red-400 bg-slate-800 hover:bg-slate-700 px-3 py-1.5 rounded-lg flex items-center gap-2 text-xs font-bold active:scale-95">LOGOUT <LogOut size={14} /></button>
        </div>
        <div className="hidden md:flex w-24 bg-slate-900 flex-col items-center py-6 shadow-2xl z-20 shrink-0 relative">
          <div className="bg-gradient-to-br from-blue-500 to-blue-700 p-3.5 rounded-2xl mb-8 shadow-lg shadow-blue-900/50"><Zap className="text-white" size={28} /></div>
          <div className="flex flex-col gap-6 w-full items-center"><button className={`p-3.5 rounded-2xl relative transition-all duration-300 ${isRedAlert ? 'bg-red-500 text-white animate-bounce shadow-[0_0_20px_rgba(239,68,68,0.5)]' : 'bg-slate-800 text-blue-400 hover:bg-slate-700 hover:text-white'}`}><Crosshair size={26} /></button></div>
        </div>

        <div className="w-full md:w-[480px] bg-white border-r border-slate-200 flex flex-col h-[50vh] md:h-full z-10 shadow-xl shrink-0">
          <div className="hidden md:flex justify-between items-center p-4 border-b border-slate-100 bg-slate-50/80 backdrop-blur shrink-0">
             <div className="text-xs font-bold text-slate-500 uppercase tracking-widest"><Building size={14} className="inline mr-1 -mt-0.5"/> {activeVenue.name}</div>
             <button onClick={handleLogout} className="flex items-center gap-1.5 bg-white border border-slate-200 hover:border-red-300 text-slate-600 hover:text-red-600 hover:bg-red-50 px-3 py-1.5 rounded-lg text-xs font-bold active:scale-95 shadow-sm"><LogOut size={14}/> LOGOUT</button>
          </div>
          <div className={`p-5 md:p-6 border-b shrink-0 transition-colors duration-300 ${isRedAlert ? 'bg-red-600 border-red-700 text-white shadow-inner' : 'bg-white border-slate-100'}`}>
            <h1 className="text-2xl md:text-3xl font-black tracking-tight flex items-center gap-3">
                {isRedAlert && <AlertTriangle size={28} className="animate-pulse" />} {isNeighborhood ? 'Community Incidents' : 'Active Incidents'}
            </h1>
          </div>
          <div className="px-5 py-3 bg-slate-50/80 border-b border-slate-200 flex justify-between items-center shrink-0">
            <span className="text-xs font-bold text-slate-500 uppercase tracking-widest">Prioritized Queue</span>
            <span className={`px-2.5 py-1 rounded-md text-xs font-black shadow-sm ${isRedAlert ? 'bg-red-500 text-white' : 'bg-slate-200 text-slate-600'}`}>{venueAlerts.length}</span>
          </div>
          
          <div className="flex-grow overflow-y-auto bg-slate-50/50 p-4 space-y-4 custom-scrollbar">
            {venueAlerts.length === 0 && (
              <div className="text-center text-slate-400 py-12 flex flex-col items-center">
                <div className="bg-slate-100 p-6 rounded-full mb-4 border border-slate-200"><Shield size={48} className="text-emerald-400/50" /></div>
                <p className="font-bold text-lg text-slate-600">All systems secure.</p>
                <p className="text-sm mt-1 font-medium text-slate-400">No active incidents detected.</p>
              </div>
            )}
            {venueAlerts.map(alert => {
              const isMuted = mutedAlerts.includes(alert.id);
              return (
              <div key={alert.id} className={`bg-white p-5 rounded-[1.5rem] shadow-sm border ${isMuted ? 'border-slate-200 opacity-80' : 'border-red-300 shadow-red-500/10'} hover:shadow-md transition-all group`}>
                {alert.network === 'LoRa Radio Mesh' && (
                   <div className="bg-purple-100 text-purple-800 text-[10px] font-black uppercase tracking-widest px-2.5 py-1 rounded-md mb-4 flex items-center gap-1.5 w-max shadow-sm border border-purple-200"><WifiOff size={12} /> {alert.network} (Offline)</div>
                )}
                <div className="flex justify-between items-start mb-4">
                  <div className="flex items-center gap-3.5">
                    <div className={`p-3 rounded-2xl text-white shadow-md shrink-0 ${alert.severity === 'Critical' ? 'bg-red-500 shadow-red-500/30' : 'bg-orange-500 shadow-orange-500/30'}`}>
                      {alert.type === 'Fire' ? <Flame size={24} /> : alert.type === 'Medical' ? <Activity size={24} /> : <ShieldAlert size={24} />}
                    </div>
                    <div className="min-w-0">
                      <h3 className="font-black text-slate-900 text-lg md:text-xl truncate tracking-tight" title={alert.roomId}>{alert.roomId}</h3>
                      <p className="text-xs font-bold text-slate-500 flex items-center gap-1.5 mt-0.5"><Clock size={12} className="text-slate-400"/> {new Date(alert.timestamp).toLocaleTimeString()}</p>
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-2">
                    <span className={`text-[10px] md:text-xs font-black uppercase tracking-widest px-2.5 py-1 rounded-md shrink-0 shadow-sm border ${alert.severity === 'Critical' ? 'bg-red-50 text-red-700 border-red-200' : 'bg-orange-50 text-orange-700 border-orange-200'}`}>{alert.severity}</span>
                    {isMuted && <span className="text-[9px] font-bold text-slate-400 uppercase flex items-center gap-1"><VolumeX size={10}/> Muted</span>}
                  </div>
                </div>
                <div className="bg-slate-50/80 p-4 rounded-2xl mb-4 border border-slate-100">
                  <p className="text-sm font-semibold text-slate-700 leading-relaxed mb-3">{alert.summary}</p>
                  <div className="flex items-center gap-2 text-xs text-slate-500 border-t border-slate-200 pt-3 font-medium">
                    {alert.source?.includes('IoT') ? <Cpu size={14} className="text-blue-500" /> : <User size={14} className="text-slate-400" />}
                    <span className="font-bold text-slate-600">Source:</span> {alert.source || 'Mobile App'}
                  </div>
                </div>
                <div className="flex gap-2">
                  <button onClick={() => { setCurrentRole('responder'); setActiveResponderAlert(alert); setResponderEndTime(Date.now() + 180000); }} className="flex-1 bg-slate-900 text-white py-2.5 rounded-xl text-xs font-bold hover:bg-blue-600 shadow-sm active:scale-95 flex items-center justify-center gap-2">
                    <MapIcon size={14} /> Tactical UI
                  </button>
                  <button onClick={() => toggleMute(alert.id)} className={`px-4 py-2.5 rounded-xl text-xs font-bold shadow-sm border ${isMuted ? 'bg-blue-50 text-blue-600 border-blue-200' : 'bg-slate-100 text-slate-600 border-slate-200 hover:bg-slate-200'}`}>
                    {isMuted ? <Volume2 size={16}/> : <VolumeX size={16}/>}
                  </button>
                  <button onClick={() => resolveAlert(alert.id)} className="px-5 bg-white border border-slate-300 text-slate-600 py-2.5 rounded-xl text-xs font-bold hover:bg-slate-50 hover:text-red-600 shadow-sm active:scale-95">Clear</button>
                </div>
              </div>
            )})}
          </div>
        </div>

        <div className="flex-grow p-4 md:p-6 flex flex-col h-[50vh] md:h-full overflow-hidden bg-slate-100">
          <div className="w-full h-full bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden flex flex-col relative p-6">
             <div className="absolute top-6 left-6 bg-slate-900/90 backdrop-blur text-white px-4 py-2 rounded-xl text-xs font-bold shadow-lg flex items-center gap-2 z-10 border border-slate-700"><Building size={14} className="text-blue-400"/> Facility Overview</div>
             <div className="flex-grow flex items-center justify-center overflow-auto p-4 custom-scrollbar bg-slate-50/50 rounded-2xl mt-12 border border-slate-100">
                <div className="flex flex-wrap justify-center gap-4 max-w-4xl">
                   {activeVenue.rooms?.map(rId => {
                     const isAlert = venueAlerts.some(a => a.roomId === rId);
                     return (
                        <div key={rId} className={`relative flex flex-col items-center justify-center border-2 rounded-[1.5rem] transition-all duration-300 p-4 min-w-[110px] min-h-[110px] shadow-sm ${isAlert ? 'border-red-500 bg-red-50 shadow-[0_0_30px_rgba(239,68,68,0.4)] animate-pulse scale-105 z-10' : 'border-slate-200 bg-white hover:border-slate-300'}`}>
                           <span className={`font-black text-center ${isAlert ? 'text-red-700 text-2xl tracking-tight' : 'text-slate-500 text-xs'}`} title={rId}>{rId.length > 20 && !isAlert ? rId.substring(0, 17) + '...' : rId}</span>
                           {isAlert && <AlertTriangle size={24} className="text-red-600 mt-2" />}
                        </div>
                     )
                   })}
                </div>
             </div>
          </div>
        </div>
      </div>
    );
  };

  // --- 5. Tactical / Responder HUD ---
  const ResponderView = () => {
    if (!activeResponderAlert) {
      return (
        <div className="flex flex-col items-center justify-center h-full bg-black text-slate-400 p-6 text-center font-mono w-full">
          <Navigation size={64} className="mb-6 opacity-50" />
          <p className="text-xl font-bold tracking-widest">NO ACTIVE RESPONDER UPLINK</p>
          <button onClick={() => setCurrentRole('staff')} className="mt-8 px-6 py-2.5 border border-slate-700 hover:bg-slate-800 rounded-lg text-slate-300 font-bold active:scale-95 transition-all">RETURN TO COMMAND</button>
        </div>
      );
    }

    const isLoRa = activeResponderAlert.network === 'LoRa Radio Mesh';
    
    // NEW MAP URL FIX
    const memoizedMap = useMemo(() => {
       if (mapMode === 'floorplan') {
         return (
           <div className="flex-grow relative flex bg-[#0f172a] overflow-hidden w-full h-full items-center justify-center">
              {activeVenue.floorplanUrl ? (
                 <div className="relative w-full h-full p-4 flex items-center justify-center">
                   <img src={activeVenue.floorplanUrl} alt="Uploaded Floorplan" className="max-w-full max-h-full object-contain opacity-80 rounded-xl shadow-[0_0_50px_rgba(59,130,246,0.1)]" />
                   <div className="absolute flex flex-col items-center justify-center z-10">
                     <div className="w-20 h-20 border-2 border-red-500/80 rounded-full absolute animate-ping"></div>
                     <div className="w-4 h-4 bg-red-500 rounded-full z-10 shadow-[0_0_20px_#ef4444]"></div>
                     <div className="mt-12 bg-black/80 border border-red-900 px-3 py-1.5 text-[10px] text-white font-bold whitespace-nowrap rounded shadow-2xl">{activeResponderAlert.roomId}</div>
                   </div>
                 </div>
              ) : (
                 <>
                    <div className="absolute inset-0 opacity-20" style={{ backgroundImage: 'linear-gradient(#3b82f6 1px, transparent 1px), linear-gradient(90deg, #3b82f6 1px, transparent 1px)', backgroundSize: '40px 40px' }}></div>
                    <div className="w-3/4 h-3/4 border-2 border-blue-500/30 relative flex items-center justify-center bg-blue-900/10 backdrop-blur-sm rounded-lg shadow-[0_0_50px_rgba(59,130,246,0.1)]">
                       <Layers size={200} className="text-blue-500/10 absolute" />
                       <div className="absolute flex flex-col items-center justify-center z-10">
                         <div className="w-20 h-20 border-2 border-red-500/80 rounded-full absolute animate-ping"></div>
                         <div className="w-4 h-4 bg-red-500 rounded-full z-10 shadow-[0_0_20px_#ef4444]"></div>
                         <div className="mt-12 bg-black/80 border border-red-900 px-3 py-1.5 text-[10px] text-white font-bold whitespace-nowrap rounded shadow-2xl">{activeResponderAlert.roomId}</div>
                       </div>
                       <div className="absolute bottom-4 right-4 text-xs text-blue-500/50 font-bold">NO FLOORPLAN UPLOADED</div>
                    </div>
                 </>
              )}
           </div>
         );
       }

       // --- CORRECTED GOOGLE MAPS EMBED URL ---
       const mapUrl = `https://maps.google.com/maps?q=${activeVenue.lat},${activeVenue.lng}&t=k&z=19&output=embed`;
       
       return (
         <div className="flex-grow relative flex bg-black overflow-hidden w-full h-full">
            <iframe title="Tactical Map" src={mapUrl} className="absolute inset-0 w-full h-full border-0 opacity-80" style={{ filter: "sepia(20%) hue-rotate(180deg) saturate(150%) brightness(80%)" }} allowFullScreen="" loading="lazy" referrerPolicy="no-referrer-when-downgrade"></iframe>
            <div className="absolute inset-0 opacity-20 pointer-events-none" style={{ backgroundImage: 'linear-gradient(#334155 1px, transparent 1px), linear-gradient(90deg, #334155 1px, transparent 1px)', backgroundSize: '40px 40px' }}></div>
            <div className="absolute inset-0 pointer-events-none flex items-center justify-center overflow-hidden">
               <div className="absolute flex flex-col items-center justify-center z-10">
                 <div className="w-16 h-16 border-2 border-red-500/80 rounded-full absolute"></div>
                 <div className="w-[100vw] h-px bg-red-500/30 absolute"></div>
                 <div className="w-px h-[100vh] bg-red-500/30 absolute"></div>
                 <div className="w-3 h-3 bg-red-500 rounded-full z-10 shadow-[0_0_15px_#ef4444]"></div>
                 <div className="absolute top-12 bg-black/80 border border-red-900 px-3 py-1.5 text-[10px] text-white font-bold whitespace-nowrap rounded shadow-2xl">OBJ: {activeResponderAlert.roomId}</div>
               </div>
            </div>
         </div>
       );
    }, [activeVenue.lat, activeVenue.lng, activeVenue.floorplanUrl, activeResponderAlert.roomId, mapMode]);

    return (
      <div className="bg-[#0a0f16] h-full w-full text-slate-300 flex flex-col font-mono selection:bg-red-500/30 overflow-hidden">
        <div className={`border-b p-3 md:p-4 flex justify-between items-center shadow-lg shrink-0 ${isLoRa ? 'bg-purple-900/20 border-purple-500/30' : 'bg-red-900/20 border-red-500/30'}`}>
          <div className="flex items-center gap-3">
            <div className={`${isLoRa ? 'bg-purple-600' : 'bg-red-600'} text-white p-2.5 rounded-lg shrink-0 shadow-lg`}><AlertTriangle size={24} /></div>
            <div className="min-w-0">
              <div className={`${isLoRa ? 'text-purple-500' : 'text-red-500'} font-black text-sm md:text-2xl tracking-widest uppercase truncate`}>TACTICAL UPLINK</div>
              <div className={`text-[10px] md:text-sm font-bold truncate ${isLoRa ? 'text-purple-400/70' : 'text-red-400/70'}`}>TOKEN: {activeResponderAlert.responderLink} • {activeVenue.name}</div>
            </div>
          </div>
          <div className="flex items-center gap-4 md:gap-6">
             <div className="hidden md:flex gap-2 mr-4">
                <button onClick={() => setResponderEndTime(Date.now() + 180000)} className="bg-slate-800 text-xs text-white px-2 py-1 rounded hover:bg-slate-700 active:scale-95">+3M</button>
                <button onClick={() => setResponderEndTime(Date.now() + 300000)} className="bg-slate-800 text-xs text-white px-2 py-1 rounded hover:bg-slate-700 active:scale-95">+5M</button>
                <button onClick={() => setResponderEndTime(Date.now() + 600000)} className="bg-slate-800 text-xs text-white px-2 py-1 rounded hover:bg-slate-700 active:scale-95">+10M</button>
             </div>
             <CountdownTimer endTime={responderEndTime} isLoRa={isLoRa} />
             <button onClick={handleLogout} className="bg-slate-800 p-3 rounded-lg text-slate-400 hover:text-white hover:bg-red-600 transition-colors active:scale-95"><LogOut size={20}/></button>
          </div>
        </div>

        <div className="p-4 flex-grow flex flex-col lg:flex-row gap-4 w-full max-w-[1800px] mx-auto overflow-hidden">
          <div className="w-full lg:w-1/3 flex flex-col gap-4 overflow-y-auto custom-scrollbar shrink-0 h-[45vh] lg:h-full">
            <div className="bg-slate-900/80 backdrop-blur p-6 border border-slate-800 rounded-2xl relative overflow-hidden shrink-0 shadow-2xl">
              <div className="absolute top-0 right-0 p-4 opacity-10 pointer-events-none"><Crosshair size={100} /></div>
              {isLoRa && (<div className="bg-purple-600/20 border border-purple-500/50 text-purple-400 text-[10px] font-bold px-3 py-1.5 rounded-lg inline-flex items-center gap-2 mb-5"><WifiOff size={14}/> LORA OFFLINE MESH ROUTING</div>)}
              <h3 className={`${isLoRa ? 'text-purple-500' : 'text-red-500'} text-[10px] md:text-xs uppercase tracking-[0.2em] font-bold mb-3`}>Target Location</h3>
              <div className="text-4xl md:text-5xl font-black text-white mb-2 tracking-tight leading-none">{activeResponderAlert.roomId}</div>
              <div className="text-sm font-bold text-slate-400 mb-6 mt-2">{activeVenue.name}</div>
              <h3 className={`${isLoRa ? 'text-purple-500' : 'text-red-500'} text-[10px] md:text-xs uppercase tracking-[0.2em] font-bold mb-3 mt-4`}>Incident Profile</h3>
              <div className="bg-black/50 p-4 rounded-xl border border-slate-800 text-slate-200">
                <p className="mb-3 text-sm font-medium leading-relaxed">{activeResponderAlert.summary}</p>
                <div className="text-[10px] text-slate-500 font-bold uppercase flex items-center gap-2 border-t border-slate-800/80 pt-3 mt-4">
                   {activeResponderAlert.source?.includes('IoT') ? <Cpu size={14} className="text-blue-500"/> : <User size={14} className="text-slate-400"/>} Source: {activeResponderAlert.source}
                </div>
              </div>
            </div>
          </div>

          <div className="w-full lg:w-2/3 bg-slate-900/80 backdrop-blur border border-slate-800 rounded-2xl flex flex-col relative overflow-hidden shadow-2xl h-[55vh] lg:h-full shrink-0">
            <div className="p-3 md:p-4 border-b border-slate-800 flex justify-between items-center bg-black/80 z-20 shrink-0">
              <div className="flex gap-2">
                 <button onClick={() => setMapMode('satellite')} className={`text-[10px] md:text-xs font-bold px-3 py-1.5 rounded flex items-center gap-2 transition-colors ${mapMode === 'satellite' ? 'bg-slate-700 text-white' : 'text-slate-500 hover:bg-slate-800 hover:text-slate-300'}`}><MapPin size={14} /> Satellite</button>
                 <button onClick={() => setMapMode('floorplan')} className={`text-[10px] md:text-xs font-bold px-3 py-1.5 rounded flex items-center gap-2 transition-colors ${mapMode === 'floorplan' ? 'bg-slate-700 text-white' : 'text-slate-500 hover:bg-slate-800 hover:text-slate-300'}`}><Layers size={14} /> Floor Plan</button>
              </div>
              <span className={`${isLoRa ? 'text-purple-500' : 'text-green-500'} text-[10px] md:text-xs font-bold tracking-widest flex items-center gap-2`}>
                 <span className={`w-2 h-2 rounded-full animate-pulse shadow-lg ${isLoRa ? 'bg-purple-500 shadow-purple-500' : 'bg-green-500 shadow-green-500'}`}></span>
                 {isLoRa ? 'LORA MESH ACTIVE' : 'SYSTEM SECURE'}
              </span>
            </div>
            
            {memoizedMap}

            <div className="bg-black/90 border-t border-slate-800 p-3 text-[10px] font-bold text-slate-500 flex justify-between z-20 shrink-0">
              <span className="truncate mr-2 font-mono text-blue-400">LAT/LNG: {activeVenue.lat}, {activeVenue.lng}</span>
              <span className="shrink-0 text-slate-600">ENC: AES-256-GCM</span>
            </div>
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