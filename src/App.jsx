import React, { useState, useEffect, useRef } from 'react';
import { 
  Flame, Activity, ShieldAlert, PhoneCall, Map as MapIcon, Info, 
  AlertTriangle, CheckCircle2, Shield, User, Send, Navigation, 
  X, Clock, MapPin, Radio, BellRing, Settings, LogOut, ChevronRight,
  Crosshair, Zap, Menu, Building, Lock, KeyRound, Plus, Trash2, Cpu, Link as LinkIcon, Crosshair as GpsIcon, Home, WifiOff
} from 'lucide-react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, collection, addDoc, onSnapshot, doc, updateDoc, deleteDoc } from 'firebase/firestore';

// --- Firebase Configuration ---
// Make sure your exact keys are still here!
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
const geminiApiKey = "YOUR_GEMINI_API_KEY_HERE"; // <--- PASTE YOUR KEY HERE
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
  Analyze the user's distress message. 
  Categorize type (Fire, Medical, Security, or General). 
  Assess severity (Critical, High, Medium, Low). 
  Provide a concise 1-sentence summary and a Spanish translation.
  Generate 2-3 short action tags (e.g., ["Bleeding", "Needs AED"]).
  Output strictly as JSON.`;

  const payload = {
    contents: [{ parts: [{ text }] }],
    systemInstruction: { parts: [{ text: systemInstruction }] },
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: {
        type: "OBJECT",
        properties: {
          type: { type: "STRING" },
          severity: { type: "STRING" },
          summary: { type: "STRING" },
          translation_es: { type: "STRING" },
          tags: { type: "ARRAY", items: { type: "STRING" } }
        },
        required: ["type", "severity", "summary", "translation_es", "tags"]
      }
    }
  };

  try {
    const result = await fetchWithRetry(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    return JSON.parse(result.candidates[0].content.parts[0].text);
  } catch (err) {
    return { type: "General", severity: "High", summary: text, translation_es: "Traducción no disponible", tags: ["Unknown Context"] };
  }
}

const triggerHardwareAlarm = () => {
  if ("vibrate" in navigator) navigator.vibrate([500, 200, 500, 200, 500]);
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (AudioContext) {
      const ctx = new AudioContext();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'square';
      osc.frequency.setValueAtTime(800, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(1200, ctx.currentTime + 0.3);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      gain.gain.exponentialRampToValueAtTime(0.00001, ctx.currentTime + 0.5);
      osc.stop(ctx.currentTime + 0.5);
    }
  } catch (e) { console.warn("Audio alarm blocked"); }
};

const notifyStaff = (alert) => {
  if (!("Notification" in window)) return;
  if (Notification.permission === "granted") {
    new Notification(`EMERGENCY: ${alert.type} in ${alert.roomId}`, {
      body: alert.summary,
      icon: "https://cdn-icons-png.flaticon.com/512/595/595067.png" 
    });
  } else if (Notification.permission !== "denied") {
    Notification.requestPermission().then(permission => {
      if (permission === "granted") notifyStaff(alert);
    });
  }
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

  const [activeResponderAlert, setActiveResponderAlert] = useState(null);
  const [responderEta, setResponderEta] = useState(180);

  const prevAlertCountRef = useRef(0);

  useEffect(() => {
    const initAuth = async () => {
      try {
        await signInAnonymously(auth);
      } catch (err) { console.error("Auth error:", err); }
    };
    initAuth();
    const unsubscribe = onAuthStateChanged(auth, setUser);
    return () => unsubscribe();
  }, []);

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

      const urlParams = new URLSearchParams(window.location.search);
      const venueCodeLink = urlParams.get('venue');
      if (venueCodeLink && currentRole === 'portal') {
         const linkedVenue = fetchedVenues.find(v => v.code === venueCodeLink);
         if (linkedVenue) {
            setActiveVenue(linkedVenue);
            setCurrentRole('guest');
         }
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
         triggerHardwareAlarm();
      }
      prevAlertCountRef.current = activeAlerts.length;

      if (activeResponderAlert) {
        const updatedResponderAlert = fetchedAlerts.find(a => a.id === activeResponderAlert.id);
        if (updatedResponderAlert) setActiveResponderAlert(updatedResponderAlert);
      }
    });

    return () => { unsubVenues(); unsubAlerts(); };
  }, [user, activeVenue?.id, activeResponderAlert?.id, currentRole]);

  useEffect(() => {
    if (currentRole === 'responder' && responderEta > 0 && activeResponderAlert) {
      const timer = setInterval(() => setResponderEta(prev => prev - 1), 1000);
      return () => clearInterval(timer);
    }
  }, [currentRole, responderEta, activeResponderAlert]);

  useEffect(() => {
    let alarmInterval;
    const activeAlerts = alerts.filter(a => a.status === 'active' && a.venueId === activeVenue?.id);
    if ((currentRole === 'staff' || currentRole === 'responder') && activeAlerts.length > 0) {
      alarmInterval = setInterval(triggerHardwareAlarm, 4000);
    }
    return () => clearInterval(alarmInterval);
  }, [currentRole, alerts, activeVenue?.id]);

  const handleLogout = () => {
    window.history.replaceState({}, document.title, window.location.pathname); 
    setCurrentRole('portal');
    setActiveVenue(null);
    setGuestRoomId('');
    setActiveResponderAlert(null);
  };

  const triggerAlert = async (type, isCustom = false, sourceOverride = null, overrideRoom = null) => {
    const targetVenue = activeVenue;
    const targetRoom = overrideRoom || guestRoomId;

    if (!user || !targetVenue || !targetRoom) return;
    setIsSubmitting(true);

    let finalSource = sourceOverride;
    let networkMethod = 'Wi-Fi / Cellular';
    if (!finalSource) {
       if (useLoraMesh) {
         finalSource = "Resident App (LoRa Offline Node)";
         networkMethod = "LoRa Radio Mesh";
       } else {
         finalSource = targetVenue.venueType === 'neighborhood' ? 'Resident Mobile App' : 'Guest Mobile App';
       }
    } else if (sourceOverride.includes('LoRa')) {
       networkMethod = "LoRa Radio Mesh";
    }

    let alertData = {
      venueId: targetVenue.id,
      roomId: targetRoom,
      type,
      status: 'active',
      timestamp: Date.now(),
      source: finalSource,
      network: networkMethod,
      severity: type === 'Fire' ? 'Critical' : type === 'Medical' ? 'Critical' : 'High',
      summary: `Automated ${type} protocol initiated for ${targetRoom} via ${finalSource}.`,
      translation_es: `Protocolo de ${type} automático iniciado para ${targetRoom} vía ${finalSource}.`,
      tags: [type.toUpperCase(), 'IMMEDIATE RESPONSE', finalSource.includes('IoT') ? 'HARDWARE' : 'HUMAN'],
      responderLink: `B-NET-${Math.random().toString(36).substring(2, 8).toUpperCase()}`
    };

    if (isCustom && customText) {
      const aiAnalysis = await analyzeEmergency(customText);
      alertData = { ...alertData, ...aiAnalysis, originalText: customText, source: 'App + AI' };
    }

    try {
      await addDoc(collection(db, 'artifacts', appId, 'public', 'data', ALERTS_COLLECTION), alertData);
      setCustomText('');
      setUseLoraMesh(false); 
    } catch (err) { console.error(err); } finally { setIsSubmitting(false); }
  };

  const resolveAlert = async (alertId) => {
    if (!user) return;
    try {
      await updateDoc(doc(db, 'artifacts', appId, 'public', 'data', ALERTS_COLLECTION, alertId), {
        status: 'resolved',
        resolvedAt: Date.now()
      });
      if (activeResponderAlert?.id === alertId) {
        setActiveResponderAlert(null);
        setCurrentRole('staff');
      }
    } catch (err) { console.error(err); }
  };

  // --- 1. Portal / Login Screen ---
  const Portal = () => {
    const [accessCode, setAccessCode] = useState('');
    const [staffPin, setStaffPin] = useState('');
    const [loginType, setLoginType] = useState('guest'); 
    const [error, setError] = useState('');
    const [isSeeding, setIsSeeding] = useState(false);

    const handleLogin = () => {
      setError('');
      if (venues.length === 0 && loginType !== 'admin') {
        setError('Database is empty! Please click "Seed Demo Data" below first.');
        return;
      }

      if (loginType === 'guest') {
        const venue = venues.find(v => v.code.toUpperCase() === accessCode.toUpperCase());
        if (venue) {
          setActiveVenue(venue);
          setGuestRoomId(venue.rooms[0] || 'Unknown');
          setCurrentRole('guest');
        } else {
          setError('Invalid Access Code. Try demo code "VEGAS24" or "OAKCREEK"');
        }
      } else if (loginType === 'staff' || loginType === 'responder') {
        if (staffPin === '1234') {
          const venue = venues.find(v => v.code.toUpperCase() === accessCode.toUpperCase());
          if (venue) {
            setActiveVenue(venue);
            setCurrentRole(loginType);
          } else { setError('Venue code required for Staff/Responder access.'); }
        } else { setError('Invalid PIN. Use "1234" for demo.'); }
      } else if (loginType === 'admin') {
        if (staffPin === '9999') {
          if (venues.length > 0) setActiveVenue(venues[0]);
          setCurrentRole('admin');
        } else { setError('Invalid Admin PIN. Use "9999" for demo.'); }
      }
    };

    const seedDemoVenues = async () => {
      setIsSeeding(true);
      setError('');
      try {
        const demoVenues = [
          { name: "Grand Horizon Resort", venueType: "resort", code: "VEGAS24", lat: "36.112634", lng: "-115.176746", rooms: ["301","302","303","304"] },
          { name: "Oak Creek Neighborhood", venueType: "neighborhood", code: "OAKCREEK", lat: "34.0522", lng: "-118.2437", rooms: ["142 Maple St", "144 Maple St", "146 Maple St"] }
        ];
        for (const v of demoVenues) { await addDoc(collection(db, 'artifacts', appId, 'public', 'data', VENUES_COLLECTION), v); }
        alert("Success! Demo Data has been injected into your Firebase.");
      } catch (err) {
        setError("Failed to seed data. Check Firebase permissions.");
      }
      setIsSeeding(false);
    };

    return (
      <div className="min-h-screen bg-slate-900 flex flex-col items-center justify-center p-6 text-slate-200">
        <div className="w-full max-w-md bg-slate-800 rounded-3xl p-8 shadow-2xl border border-slate-700 relative">
          
          {/* Prominent warning if database is empty */}
          {venues.length === 0 && (
             <div className="absolute -top-12 left-0 right-0 bg-yellow-500 text-yellow-900 font-bold p-2 rounded-lg text-center text-xs animate-bounce shadow-lg">
               ⚠️ DATABASE IS EMPTY - CLICK "SEED DEMO DATA" BELOW ⚠️
             </div>
          )}

          <div className="flex flex-col items-center mb-8">
            <div className="bg-blue-600 p-4 rounded-2xl mb-4 shadow-[0_0_20px_rgba(37,99,235,0.4)]"><Zap size={32} className="text-white" /></div>
            <h1 className="text-2xl font-bold text-white tracking-tight">BeaconNet</h1>
            <p className="text-slate-400 text-sm">Unified Emergency Mesh</p>
          </div>

          <div className="flex gap-2 bg-slate-900 p-1.5 rounded-xl mb-6">
            <button onClick={() => {setLoginType('guest'); setError('');}} className={`flex-1 py-2 text-sm font-bold rounded-lg transition-colors ${loginType === 'guest' ? 'bg-slate-700 text-white' : 'text-slate-500 hover:text-slate-300'}`}>Citizen</button>
            <button onClick={() => {setLoginType('staff'); setError('');}} className={`flex-1 py-2 text-sm font-bold rounded-lg transition-colors ${loginType === 'staff' ? 'bg-slate-700 text-white' : 'text-slate-500 hover:text-slate-300'}`}>Command</button>
            <button onClick={() => {setLoginType('admin'); setError('');}} className={`flex-1 py-2 text-sm font-bold rounded-lg transition-colors ${loginType === 'admin' ? 'bg-slate-700 text-white' : 'text-slate-500 hover:text-slate-300'}`}>Admin</button>
          </div>

          <div className="space-y-4">
            {loginType !== 'admin' && (
              <div>
                <label className="text-xs font-bold text-slate-400 uppercase tracking-wider">Zone Code</label>
                <div className="mt-1 relative">
                  <Building size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                  <input type="text" value={accessCode} onChange={e => setAccessCode(e.target.value.toUpperCase())} placeholder="e.g. VEGAS24" className="w-full bg-slate-900 border border-slate-700 rounded-xl py-3 pl-10 pr-4 text-white focus:ring-2 focus:ring-blue-500 outline-none uppercase font-mono" />
                </div>
              </div>
            )}

            {(loginType === 'staff' || loginType === 'admin') && (
              <div>
                <label className="text-xs font-bold text-slate-400 uppercase tracking-wider">Security PIN</label>
                <div className="mt-1 relative">
                  <KeyRound size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                  <input type="password" value={staffPin} onChange={e => setStaffPin(e.target.value)} placeholder={loginType === 'admin' ? "Demo: 9999" : "Demo: 1234"} className="w-full bg-slate-900 border border-slate-700 rounded-xl py-3 pl-10 pr-4 text-white focus:ring-2 focus:ring-blue-500 outline-none" />
                </div>
              </div>
            )}

            {error && <div className="text-red-400 text-sm font-medium bg-red-900/20 p-3 rounded-lg border border-red-500/20 flex items-start gap-2"><AlertTriangle size={16} className="shrink-0 mt-0.5" /> {error}</div>}

            <button onClick={handleLogin} className="w-full bg-blue-600 hover:bg-blue-500 text-white font-bold py-3 rounded-xl mt-4 transition-colors flex justify-center items-center gap-2">
               Connect to Mesh <ChevronRight size={18} />
            </button>
          </div>
          
          {/* Seed button is always visible until clicked for safety during hackathons */}
          {venues.length === 0 && (
             <button onClick={seedDemoVenues} disabled={isSeeding} className="w-full mt-6 bg-green-600 hover:bg-green-500 text-white font-bold py-3 rounded-xl transition-colors shadow-lg shadow-green-900/50">
               {isSeeding ? 'Injecting Data...' : '1. Seed Demo Data to Firebase'}
             </button>
          )}
        </div>
      </div>
    );
  };

  // --- 2. Admin Settings View ---
  const AdminSettings = () => {
    const [formData, setFormData] = useState({ name: '', venueType: 'resort', code: '', lat: '', lng: '', roomsStr: '' });
    const [isLocating, setIsLocating] = useState(false);
    
    const [iotRoom, setIotRoom] = useState(activeVenue?.rooms?.[0] || '');
    const [iotType, setIotType] = useState('Fire');
    const [iotDevice, setIotDevice] = useState('LoRa Smart Smoke Detector');

    useEffect(() => { if (venues.length > 0 && !activeVenue) setActiveVenue(venues[0]); }, [venues]);

    const handleSave = async (e) => {
      e.preventDefault();
      const roomsArray = formData.roomsStr.split(',').map(s => s.trim()).filter(s => s);
      const newVenue = { 
        name: formData.name, 
        venueType: formData.venueType, 
        code: formData.code.toUpperCase(), 
        lat: formData.lat, 
        lng: formData.lng, 
        rooms: roomsArray 
      };
      
      try {
        // Try to save to Firebase
        await addDoc(collection(db, 'artifacts', appId, 'public', 'data', VENUES_COLLECTION), newVenue);
        
        // Clear the form
        setFormData({ name: '', venueType: 'resort', code: '', lat: '', lng: '', roomsStr: '' });
        
        // Show a success popup!
        alert("Success! Infrastructure created. You should see it in the list on the right.");
        
      } catch(err) { 
        console.error(err); 
        // Show the exact error on the screen if it fails
        alert("Error creating infrastructure: " + err.message);
      }
    };

    const handleAutoDetectGPS = (e) => {
        e.preventDefault();
        if ("geolocation" in navigator) {
            setIsLocating(true);
            navigator.geolocation.getCurrentPosition(
                (position) => {
                    setFormData(prev => ({...prev, lat: position.coords.latitude.toFixed(6), lng: position.coords.longitude.toFixed(6)}));
                    setIsLocating(false);
                },
                (error) => {
                    alert("Could not access GPS. Please ensure location permissions are granted.");
                    setIsLocating(false);
                }
            );
        } else { alert("GPS Geolocation is not supported by your browser."); }
    };

    const copyDeepLink = (code) => {
        const link = `${window.location.origin}${window.location.pathname}?venue=${code}`;
        navigator.clipboard.writeText(link);
        alert(`Copied Resident/Guest Link:\n${link}`);
    };

    return (
      <div className="min-h-screen bg-slate-100 p-4 md:p-8 overflow-y-auto">
         <div className="max-w-4xl mx-auto">
            <div className="flex justify-between items-center mb-8">
               <h1 className="text-3xl font-black text-slate-900">Platform Admin</h1>
               <button onClick={handleLogout} className="flex items-center gap-2 bg-white px-4 py-2 rounded-lg border border-slate-300 shadow-sm text-slate-600 hover:text-red-600"><LogOut size={16}/> Logout</button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
               <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200">
                  <h2 className="text-lg font-bold mb-4 flex items-center gap-2"><Plus size={20}/> Add New Infrastructure</h2>
                  <form onSubmit={handleSave} className="space-y-4">
                     <div className="flex gap-4">
                         <div className="flex-1">
                           <label className="block text-sm font-bold text-slate-700 mb-1">Infrastructure Type</label>
                           <select value={formData.venueType} onChange={e=>setFormData({...formData, venueType: e.target.value})} className="w-full p-2.5 bg-slate-50 border border-slate-300 rounded-lg outline-none">
                               <option value="resort">Hospitality / Resort</option>
                               <option value="neighborhood">Residential / Municipality</option>
                           </select>
                         </div>
                         <div className="flex-1">
                           <label className="block text-sm font-bold text-slate-700 mb-1">Zone Name</label>
                           <input required type="text" value={formData.name} onChange={e=>setFormData({...formData, name: e.target.value})} className="w-full p-2.5 bg-slate-50 border border-slate-300 rounded-lg outline-none" placeholder="e.g. Oak Creek" />
                         </div>
                     </div>
                     <div>
                       <label className="block text-sm font-bold text-slate-700 mb-1">Access Code (Unique)</label>
                       <input required type="text" value={formData.code} onChange={e=>setFormData({...formData, code: e.target.value.toUpperCase()})} className="w-full p-2.5 bg-slate-50 border border-slate-300 rounded-lg outline-none uppercase font-mono" placeholder="e.g. OAKCREEK" />
                     </div>
                     
                     <div className="bg-slate-50 p-3 rounded-lg border border-slate-200">
                        <div className="flex justify-between items-center mb-2">
                           <label className="block text-sm font-bold text-slate-700">Geographic Bounds</label>
                           <button onClick={handleAutoDetectGPS} type="button" className="text-xs bg-blue-100 text-blue-700 px-2 py-1 rounded flex items-center gap-1 hover:bg-blue-200 transition-colors font-bold">
                              {isLocating ? <div className="w-3 h-3 border-2 border-blue-500 border-t-transparent rounded-full animate-spin"/> : <GpsIcon size={12}/>} Auto-Detect
                           </button>
                        </div>
                        <div className="flex gap-4">
                            <div className="flex-1"><input required type="text" value={formData.lat} onChange={e=>setFormData({...formData, lat: e.target.value})} className="w-full p-2 bg-white border border-slate-300 rounded outline-none text-sm" placeholder="Lat" /></div>
                            <div className="flex-1"><input required type="text" value={formData.lng} onChange={e=>setFormData({...formData, lng: e.target.value})} className="w-full p-2 bg-white border border-slate-300 rounded outline-none text-sm" placeholder="Lng" /></div>
                        </div>
                     </div>

                     <div>
                       <label className="block text-sm font-bold text-slate-700 mb-1">Addresses / Zones (Comma Separated)</label>
                       <textarea required value={formData.roomsStr} onChange={e=>setFormData({...formData, roomsStr: e.target.value})} className="w-full p-2.5 bg-slate-50 border border-slate-300 rounded-lg outline-none" placeholder="101 Maple St, 102 Maple St..." rows={3}></textarea>
                     </div>
                     <button type="submit" className="w-full bg-slate-900 text-white font-bold py-3 rounded-lg hover:bg-slate-800 transition-colors">Create Infrastructure</button>
                  </form>
               </div>

               <div className="space-y-6">
                  <div className="bg-slate-900 p-6 rounded-2xl shadow-xl border border-slate-800 text-slate-200">
                      <h2 className="text-lg font-bold mb-4 flex items-center gap-2 text-white"><Cpu size={20} className="text-blue-500"/> IoT / LoRa Simulator</h2>
                      
                      {activeVenue ? (
                        <div className="space-y-4">
                            <div className="flex gap-4">
                                <div className="flex-1">
                                    <label className="block text-xs font-bold text-slate-400 uppercase mb-1">Target Address</label>
                                    <select value={iotRoom} onChange={e => setIotRoom(e.target.value)} className="w-full bg-slate-800 border border-slate-700 rounded-lg p-2 text-white outline-none">
                                        {activeVenue.rooms?.map(r => <option key={r} value={r}>{r}</option>)}
                                    </select>
                                </div>
                                <div className="flex-1">
                                    <label className="block text-xs font-bold text-slate-400 uppercase mb-1">Category</label>
                                    <select value={iotType} onChange={e => setIotType(e.target.value)} className="w-full bg-slate-800 border border-slate-700 rounded-lg p-2 text-white outline-none">
                                        <option value="Fire">Fire / Flood</option>
                                        <option value="Security">Security / Panic</option>
                                        <option value="Medical">Medical Emergency</option>
                                    </select>
                                </div>
                            </div>
                            <div>
                                <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">Network Device</label>
                                <select value={iotDevice} onChange={e => setIotDevice(e.target.value)} className="w-full bg-slate-800 border border-slate-700 rounded-lg p-2 text-white outline-none">
                                    <option>LoRa Basement Flood Sensor</option>
                                    <option>LoRa Smart Smoke Detector</option>
                                    <option>Offline LoRa Panic Button</option>
                                </select>
                            </div>

                            <button onClick={() => triggerAlert(iotType, false, `IoT Sensor (${iotDevice})`, iotRoom)} disabled={isSubmitting} className="w-full bg-blue-600 hover:bg-blue-500 text-white font-bold py-2.5 rounded-lg mt-2 flex items-center justify-center gap-2">
                                {isSubmitting ? 'Transmitting...' : 'Trigger Hardware Sensor'}
                            </button>
                        </div>
                      ) : <div className="text-yellow-500 text-sm">Create an infrastructure block first.</div>}
                  </div>

                  <div>
                      <h2 className="text-lg font-bold mb-4 flex items-center gap-2 text-slate-800"><Building size={20}/> Managed Infrastructures</h2>
                      {venues.map(v => (
                        <div key={v.id} className="bg-white p-5 rounded-2xl shadow-sm border border-slate-200 mb-4">
                            <div className="flex justify-between items-start">
                              <div>
                                <h3 className="font-bold text-lg text-slate-900 flex items-center gap-2">
                                  {v.venueType === 'neighborhood' ? <Home size={18} className="text-slate-500" /> : <Building size={18} className="text-slate-500" />}
                                  {v.name}
                                </h3>
                                <span className="inline-block bg-slate-100 text-slate-600 text-xs font-mono px-2 py-1 rounded mt-1 border border-slate-200">CODE: {v.code}</span>
                              </div>
                              <div className="flex gap-2">
                                <button onClick={() => copyDeepLink(v.code)} title="Copy Citizen App Link" className="text-blue-500 hover:bg-blue-50 p-2 rounded-lg border border-blue-100"><LinkIcon size={18}/></button>
                                <button onClick={() => deleteDoc(doc(db, 'artifacts', appId, 'public', 'data', VENUES_COLLECTION, v.id))} className="text-slate-400 hover:text-red-600 hover:bg-red-50 p-2 rounded-lg"><Trash2 size={18}/></button>
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
    const currentRoomAlert = alerts.find(a => a.venueId === activeVenue.id && a.roomId === guestRoomId && a.status === 'active');
    const isNeighborhood = activeVenue.venueType === 'neighborhood';

    if (currentRoomAlert) {
      return (
        <div className="flex flex-col items-center justify-center min-h-screen w-full p-6 text-center bg-slate-900 text-white overflow-y-auto">
          <div className="relative mb-6 mt-4">
             <div className="absolute inset-0 bg-red-500 rounded-full animate-ping opacity-20"></div>
             <div className="bg-red-600 p-6 rounded-full shadow-[0_0_40px_rgba(220,38,38,0.5)] z-10 relative"><Radio size={40} className="animate-pulse" /></div>
          </div>
          <h2 className="text-2xl md:text-3xl font-bold mb-2 tracking-tight">SOS Transmitting</h2>
          <p className="text-slate-300 mb-6 max-w-sm text-md">Response teams are routing to {guestRoomId}.</p>
          <div className="bg-slate-800 p-5 rounded-2xl border border-slate-700 w-full max-w-md mb-6">
            <h3 className="font-semibold text-slate-100 mb-3 flex items-center justify-center gap-2"><ShieldAlert size={18} className="text-red-400" /> Action Required</h3>
            <ul className="text-left text-slate-300 space-y-3">
              <li className="flex items-start gap-3 bg-slate-900/50 p-3 rounded-xl border border-slate-700/50 text-sm">
                <CheckCircle2 size={18} className="text-emerald-400 mt-0.5 shrink-0" />
                <span>{isNeighborhood ? "Evacuate the house if water levels rise rapidly or you detect structural damage." : "Evacuate immediately if you detect smoke. Feel doors before opening."}</span>
              </li>
              <li className="flex items-start gap-3 bg-slate-900/50 p-3 rounded-xl border border-slate-700/50 text-sm">
                <CheckCircle2 size={18} className="text-emerald-400 mt-0.5 shrink-0" />
                <span>Unlock front doors to allow rapid responder access if safe to do so.</span>
              </li>
            </ul>
          </div>
          <button onClick={() => resolveAlert(currentRoomAlert.id)} className="text-sm text-slate-500 hover:text-white transition-colors underline decoration-slate-600 pb-8">Cancel Signal</button>
        </div>
      );
    }

    return (
      <div className="w-full h-full bg-slate-100 overflow-y-auto">
        <div className="max-w-md mx-auto min-h-full bg-white shadow-xl flex flex-col">
          <div className="p-6 md:p-8 text-center shrink-0 border-b border-slate-100 bg-white sticky top-0 z-10">
            <div className="flex justify-between items-start mb-2">
               <div className="inline-flex items-center p-2 bg-slate-50 rounded-xl shadow-sm border border-slate-100">
                 <Zap className="text-blue-600 mr-1.5" size={18} /><span className="font-bold text-sm tracking-tight text-slate-800">BeaconNet</span>
               </div>
               <button onClick={handleLogout} className="text-slate-400 hover:text-slate-600 p-2"><LogOut size={18}/></button>
            </div>
            <h1 className="text-2xl font-black text-slate-800 mb-1">{activeVenue.name}</h1>
            <div className="mt-3 flex items-center justify-center bg-slate-50 p-2 rounded-lg border border-slate-200">
              <MapPin size={14} className="text-slate-400 mr-2"/>
              <select value={guestRoomId} onChange={(e) => setGuestRoomId(e.target.value)} className="bg-transparent text-slate-700 text-sm font-bold outline-none cursor-pointer">
                <option value="" disabled>Select {isNeighborhood ? 'Address' : 'Zone'}...</option>
                {activeVenue.rooms?.map(id => <option key={id} value={id}>{id}</option>)}
              </select>
            </div>
          </div>

          <div className="flex-grow px-6 py-6 space-y-4 bg-slate-50/50">
            <div className="bg-purple-50 border border-purple-200 p-4 rounded-2xl flex items-center justify-between shadow-sm mb-2">
              <div className="flex items-center gap-3">
                 <div className={`p-2 rounded-full ${useLoraMesh ? 'bg-purple-600 text-white' : 'bg-purple-200 text-purple-500'}`}>
                    <WifiOff size={18} />
                 </div>
                 <div>
                    <h3 className="font-bold text-purple-900 text-sm">Internet Down?</h3>
                    <p className="text-xs text-purple-700">Simulate Offline LoRa Mesh</p>
                 </div>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input type="checkbox" className="sr-only peer" checked={useLoraMesh} onChange={() => setUseLoraMesh(!useLoraMesh)} />
                <div className="w-11 h-6 bg-purple-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-purple-600"></div>
              </label>
            </div>

            <button onClick={() => triggerAlert('Medical')} disabled={!guestRoomId || isSubmitting} className="group w-full bg-white hover:bg-red-50 border-2 border-slate-100 hover:border-red-500 rounded-3xl p-4 flex items-center gap-4 transition-all shadow-sm disabled:opacity-50">
              <div className="bg-red-100 text-red-600 group-hover:bg-red-600 group-hover:text-white transition-colors p-3.5 rounded-2xl shrink-0"><Activity size={24} /></div>
              <div className="text-left flex-grow">
                <h2 className="text-lg font-bold text-slate-800">Medical SOS</h2>
                <p className="text-slate-500 text-xs mt-0.5">Injury, illness, distress</p>
              </div>
              <ChevronRight size={20} className="text-slate-300 group-hover:text-red-500 shrink-0" />
            </button>

            <button onClick={() => triggerAlert('Fire')} disabled={!guestRoomId || isSubmitting} className="group w-full bg-white hover:bg-orange-50 border-2 border-slate-100 hover:border-orange-500 rounded-3xl p-4 flex items-center gap-4 transition-all shadow-sm disabled:opacity-50">
              <div className="bg-orange-100 text-orange-600 group-hover:bg-orange-600 group-hover:text-white transition-colors p-3.5 rounded-2xl shrink-0"><Flame size={24} /></div>
              <div className="text-left flex-grow">
                <h2 className="text-lg font-bold text-slate-800">Fire / Flood</h2>
                <p className="text-slate-500 text-xs mt-0.5">Evacuation required</p>
              </div>
              <ChevronRight size={20} className="text-slate-300 group-hover:text-orange-500 shrink-0" />
            </button>

            <button onClick={() => triggerAlert('Security')} disabled={!guestRoomId || isSubmitting} className="group w-full bg-white hover:bg-blue-50 border-2 border-slate-100 hover:border-blue-500 rounded-3xl p-4 flex items-center gap-4 transition-all shadow-sm disabled:opacity-50">
              <div className="bg-blue-100 text-blue-600 group-hover:bg-blue-600 group-hover:text-white transition-colors p-3.5 rounded-2xl shrink-0"><ShieldAlert size={24} /></div>
              <div className="text-left flex-grow">
                <h2 className="text-lg font-bold text-slate-800">Security Threat</h2>
                <p className="text-slate-500 text-xs mt-0.5">Intruder, physical danger</p>
              </div>
              <ChevronRight size={20} className="text-slate-300 group-hover:text-blue-500 shrink-0" />
            </button>

            <div className="bg-white p-4 rounded-3xl border border-slate-200 mt-6 shadow-sm">
              <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 mb-3 ml-1">Custom AI Alert</label>
              <div className="flex gap-2 bg-slate-50 p-1.5 rounded-2xl border border-slate-200 focus-within:border-blue-500 transition-all">
                <input type="text" value={customText} onChange={(e) => setCustomText(e.target.value)} placeholder="Describe situation..." className="flex-grow p-2 text-sm bg-transparent text-slate-800 outline-none min-w-0" disabled={isSubmitting} />
                <button onClick={() => triggerAlert('Custom', true)} disabled={isSubmitting || !customText.trim() || !guestRoomId} className="bg-slate-900 text-white px-4 py-2 rounded-xl text-sm hover:bg-blue-600 disabled:opacity-50 transition-colors font-bold shrink-0 flex items-center justify-center min-w-[70px]">
                  {isSubmitting ? <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : 'Send'}
                </button>
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
      <div className="flex flex-col md:flex-row h-full w-full bg-slate-100 overflow-hidden font-sans">
        
        {isRedAlert && <div className="absolute inset-0 border-[8px] border-red-500 pointer-events-none z-50 animate-pulse"></div>}

        <div className="md:hidden w-full bg-slate-900 text-white p-4 flex justify-between items-center shrink-0 z-20 shadow-md">
          <div className="flex items-center gap-2 font-bold"><Zap className="text-blue-500" size={20} /> Command</div>
          <button onClick={handleLogout} className="text-slate-400 hover:text-red-400 flex items-center gap-2 text-sm font-bold transition-colors">
            LOGOUT <LogOut size={18} />
          </button>
        </div>

        <div className="hidden md:flex w-20 bg-slate-900 flex-col items-center py-6 shadow-2xl z-20 shrink-0">
          <div className="bg-blue-600 p-3 rounded-xl mb-8 shadow-lg shadow-blue-900/50"><Zap className="text-white" size={24} /></div>
          <div className="flex flex-col gap-6 w-full items-center">
            <button className={`text-blue-400 p-3 rounded-xl relative transition ${isRedAlert ? 'bg-red-500 text-white animate-bounce' : 'bg-slate-800 hover:bg-slate-700'}`}>
              <Crosshair size={24} />
              {isRedAlert && <span className="absolute top-0 right-0 w-3 h-3 bg-red-900 rounded-full border-2 border-red-500 animate-ping"></span>}
            </button>
            <button className="text-slate-500 hover:text-slate-300 transition-colors p-3"><Settings size={24} /></button>
          </div>
          <div className="mt-auto flex flex-col items-center pb-4">
            <button onClick={handleLogout} className="text-slate-500 hover:text-red-500 transition-colors p-2 flex flex-col items-center gap-1 group">
              <LogOut size={24} className="group-hover:-translate-x-1 transition-transform" />
              <span className="text-[10px] font-bold uppercase tracking-wider">Logout</span>
            </button>
          </div>
        </div>

        <div className="w-full md:w-[450px] bg-white border-r border-slate-200 flex flex-col h-[50vh] md:h-full z-10 shadow-xl shrink-0">
          <div className={`p-4 md:p-6 border-b shrink-0 transition-colors ${isRedAlert ? 'bg-red-600 border-red-700 text-white' : 'border-slate-100'}`}>
            <h1 className="text-xl md:text-2xl font-black tracking-tight flex items-center gap-2">
                {isRedAlert && <AlertTriangle size={24} className="animate-pulse" />} 
                {isNeighborhood ? 'Community Incidents' : 'Active Incidents'}
            </h1>
            <p className={`text-xs md:text-sm font-medium mt-1 ${isRedAlert ? 'text-red-200' : 'text-slate-500'}`}>{activeVenue.name}</p>
          </div>
          
          <div className="px-4 md:px-6 py-2 md:py-3 bg-slate-50 border-b border-slate-200 flex justify-between items-center shrink-0">
            <span className="text-[10px] md:text-xs font-bold text-slate-500 uppercase tracking-wider">Prioritized Queue</span>
            <span className={`px-2 py-0.5 rounded-full text-[10px] md:text-xs font-bold ${isRedAlert ? 'bg-red-100 text-red-700' : 'bg-slate-200 text-slate-500'}`}>{venueAlerts.length}</span>
          </div>
          
          <div className="flex-grow overflow-y-auto bg-slate-50 p-4 space-y-4">
            {venueAlerts.length === 0 && (
              <div className="text-center text-slate-400 py-8 flex flex-col items-center">
                <Shield size={48} className="text-slate-200 mb-3 stroke-1" />
                <p className="font-medium text-md text-slate-500">All systems secure.</p>
                <p className="text-xs mt-1">No active incidents at {activeVenue.name}.</p>
              </div>
            )}

            {venueAlerts.map(alert => (
              <div key={alert.id} className="bg-white p-4 rounded-2xl shadow-sm border-2 border-red-200 hover:border-red-400 transition-all">
                
                {alert.network === 'LoRa Radio Mesh' && (
                   <div className="bg-purple-100 text-purple-800 text-[10px] font-bold uppercase tracking-widest px-2 py-1 rounded mb-3 flex items-center gap-1 w-max">
                      <WifiOff size={12} /> {alert.network} (Internet Offline)
                   </div>
                )}

                <div className="flex justify-between items-start mb-3">
                  <div className="flex items-center gap-3">
                    <div className={`p-2.5 rounded-xl text-white shadow-inner shrink-0 ${alert.severity === 'Critical' ? 'bg-red-500' : 'bg-orange-500'}`}>
                      {alert.type === 'Fire' ? <Flame size={20} /> : alert.type === 'Medical' ? <Activity size={20} /> : <ShieldAlert size={20} />}
                    </div>
                    <div className="min-w-0">
                      <h3 className="font-bold text-slate-900 text-base md:text-lg truncate">{alert.roomId}</h3>
                      <p className="text-[10px] md:text-xs font-semibold text-slate-500 flex items-center gap-1"><Clock size={12} /> {new Date(alert.timestamp).toLocaleTimeString()}</p>
                    </div>
                  </div>
                  <span className={`text-[10px] md:text-xs font-black uppercase tracking-widest px-2 py-1 rounded-md shrink-0 ${alert.severity === 'Critical' ? 'bg-red-100 text-red-700' : 'bg-orange-100 text-orange-700'}`}>{alert.severity}</span>
                </div>
                <div className="bg-slate-50 p-3 rounded-xl mb-3 border border-slate-100">
                  <p className="text-sm font-medium text-slate-800 leading-snug mb-2">{alert.summary}</p>
                  
                  <div className="flex items-center gap-1.5 text-xs text-slate-500 border-t border-slate-200 pt-2">
                    {alert.source?.includes('IoT') ? <Cpu size={14} className="text-blue-500" /> : <User size={14} className="text-slate-400" />}
                    <span className="font-semibold text-slate-600">Source:</span> {alert.source || 'Mobile App'}
                  </div>

                  {alert.tags && (
                    <div className="flex flex-wrap gap-1.5 mt-3">
                      {alert.tags.map((tag, idx) => <span key={idx} className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${tag === 'HARDWARE' ? 'bg-blue-100 text-blue-700 border-blue-200' : 'bg-slate-200 text-slate-600 border-slate-300'}`}>{tag}</span>)}
                    </div>
                  )}
                </div>
                <div className="flex gap-2 mt-4">
                  <button onClick={() => { setCurrentRole('responder'); setActiveResponderAlert(alert); setResponderEta(180); }} className="flex-1 bg-slate-900 text-white py-2 rounded-xl text-xs font-semibold hover:bg-slate-800 flex items-center justify-center gap-2">
                    <MapIcon size={14} /> Tactical UI
                  </button>
                  <button onClick={() => resolveAlert(alert.id)} className="px-4 bg-white border border-slate-300 text-slate-700 py-2 rounded-xl text-xs font-semibold hover:bg-slate-50">Clear</button>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="flex-grow p-4 md:p-8 flex flex-col bg-slate-200 h-[50vh] md:h-full overflow-hidden">
          <div className="w-full h-full bg-white rounded-2xl border border-slate-300 shadow-sm overflow-hidden flex flex-col relative p-6">
             <div className="absolute top-4 left-4 bg-slate-900 text-white px-3 py-1.5 rounded-lg text-xs font-bold shadow flex items-center gap-2 z-10"><Building size={14} /> {activeVenue.name} Overview</div>
             
             <div className="flex-grow flex items-center justify-center overflow-auto p-4 custom-scrollbar">
                <div className="flex flex-wrap justify-center gap-4 max-w-4xl">
                   {activeVenue.rooms?.map(rId => {
                     const isAlert = venueAlerts.some(a => a.roomId === rId);
                     return (
                        <div key={rId} className={`relative flex flex-col items-center justify-center border-2 rounded-xl transition-all p-4 min-w-[100px] min-h-[100px] ${isAlert ? 'border-red-500 bg-red-50 shadow-[0_0_20px_rgba(239,68,68,0.3)] animate-pulse scale-105 z-10' : 'border-slate-200 bg-slate-50'}`}>
                           <span className={`font-bold text-center ${isAlert ? 'text-red-700 text-xl' : 'text-slate-500 text-sm'}`}>{rId}</span>
                           {isAlert && <AlertTriangle size={20} className="text-red-600 mt-2" />}
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
          <p className="text-xl">NO ACTIVE RESPONDER UPLINK</p>
          <button onClick={() => setCurrentRole('staff')} className="mt-8 px-6 py-2 border border-slate-700 hover:bg-slate-800 rounded text-slate-300">RETURN TO COMMAND</button>
        </div>
      );
    }

    const isLoRa = activeResponderAlert.network === 'LoRa Radio Mesh';

    return (
      <div className="bg-[#0a0f16] h-full w-full text-slate-300 flex flex-col font-mono selection:bg-red-500/30 overflow-hidden">
        <div className={`border-b p-3 flex justify-between items-center shadow-lg shrink-0 ${isLoRa ? 'bg-purple-900/20 border-purple-500/30' : 'bg-red-900/20 border-red-500/30'}`}>
          <div className="flex items-center gap-3">
            <div className={`${isLoRa ? 'bg-purple-600' : 'bg-red-600'} text-white p-2 rounded animate-pulse shrink-0`}><AlertTriangle size={20} /></div>
            <div className="min-w-0">
              <div className={`${isLoRa ? 'text-purple-500' : 'text-red-500'} font-bold text-sm md:text-xl tracking-widest uppercase truncate`}>TACTICAL UPLINK</div>
              <div className={`text-[10px] md:text-xs truncate ${isLoRa ? 'text-purple-400/70' : 'text-red-400/70'}`}>TOKEN: {activeResponderAlert.responderLink} • {activeVenue.name}</div>
            </div>
          </div>
          <div className="flex items-center gap-4">
             <div className="text-right shrink-0">
               <div className="text-2xl md:text-3xl font-light text-white">{Math.floor(responderEta / 60)}:{(responderEta % 60).toString().padStart(2, '0')}</div>
               <div className={`text-[8px] md:text-[10px] uppercase tracking-widest ${isLoRa ? 'text-purple-400' : 'text-red-400'}`}>Est. Arrival</div>
             </div>
             <button onClick={handleLogout} className="bg-slate-800 p-2 rounded text-slate-500 hover:text-white"><LogOut size={16}/></button>
          </div>
        </div>

        <div className="p-4 flex-grow flex flex-col lg:flex-row gap-4 w-full max-w-[1600px] mx-auto overflow-hidden">
          <div className="w-full lg:w-1/3 flex flex-col gap-4 overflow-y-auto custom-scrollbar shrink-0 h-[45vh] lg:h-full">
            <div className="bg-slate-900/80 p-5 border border-slate-800 rounded-lg relative overflow-hidden shrink-0">
              <div className="absolute top-0 right-0 p-2 opacity-10 pointer-events-none"><Crosshair size={80} /></div>
              
              {isLoRa && (
                 <div className="bg-purple-600 text-white text-[10px] font-bold px-2 py-1 rounded inline-flex items-center gap-1 mb-4">
                    <WifiOff size={12}/> LORA OFFLINE MESH ROUTING
                 </div>
              )}

              <h3 className={`${isLoRa ? 'text-purple-500' : 'text-red-500'} text-[10px] md:text-xs uppercase tracking-[0.2em] font-bold mb-3`}>Target Location</h3>
              <div className="text-3xl md:text-4xl font-black text-white mb-2">{activeResponderAlert.roomId}</div>
              <div className="text-xs text-slate-400 mb-4">{activeVenue.name}</div>
              
              <h3 className={`${isLoRa ? 'text-purple-500' : 'text-red-500'} text-[10px] md:text-xs uppercase tracking-[0.2em] font-bold mb-2 mt-4`}>Incident Profile</h3>
              <div className="bg-black/50 p-3 rounded border border-slate-800 text-slate-200">
                <p className="mb-2 text-sm">{activeResponderAlert.summary}</p>
                <p className="text-xs text-yellow-500/80 italic border-l-2 border-yellow-500 pl-3 py-1 mb-3">"{activeResponderAlert.translation_es}"</p>
                <div className="text-[10px] text-slate-500 uppercase flex items-center gap-1 border-t border-slate-800 pt-2">
                   {activeResponderAlert.source?.includes('IoT') ? <Cpu size={12}/> : <User size={12}/>}
                   Source: {activeResponderAlert.source}
                </div>
              </div>
            </div>
          </div>

          <div className="w-full lg:w-2/3 bg-slate-900/80 border border-slate-800 rounded-lg flex flex-col relative overflow-hidden shadow-2xl h-[55vh] lg:h-full shrink-0">
            <div className="p-3 border-b border-slate-800 flex justify-between items-center bg-black/80 z-20 shrink-0">
              <span className="text-slate-400 text-[10px] md:text-xs uppercase font-bold flex items-center gap-2"><MapPin size={14} /> Live Satellite</span>
              <span className={`${isLoRa ? 'text-purple-500' : 'text-green-500'} text-[10px] md:text-xs tracking-widest flex items-center gap-1.5`}><span className={`w-1.5 h-1.5 rounded-full animate-pulse ${isLoRa ? 'bg-purple-500' : 'bg-green-500'}`}></span>{isLoRa ? 'LORA MESH ACTIVE' : 'ACTIVE'}</span>
            </div>
            
            <div className="flex-grow relative flex bg-black overflow-hidden w-full h-full">
               
               {/* FIXED GOOGLE MAPS SATELLITE URL */}
               <iframe 
                 title="Tactical Map"
                 src={`https://maps.google.com/maps?q=${activeVenue.lat},${activeVenue.lng}&t=k&z=19&ie=UTF8&iwloc=&output=embed`}
                 className="absolute inset-0 w-full h-full border-0 opacity-80" 
                 style={{ filter: "sepia(20%) hue-rotate(180deg) saturate(150%) brightness(80%)" }}
                 allowFullScreen="" loading="lazy" referrerPolicy="no-referrer-when-downgrade"
               ></iframe>

               <div className="absolute inset-0 opacity-20 pointer-events-none" style={{ backgroundImage: 'linear-gradient(#334155 1px, transparent 1px), linear-gradient(90deg, #334155 1px, transparent 1px)', backgroundSize: '40px 40px' }}></div>
               <div className="absolute inset-0 pointer-events-none flex items-center justify-center overflow-hidden">
                  <div className={`absolute w-[150%] max-w-[800px] aspect-square animate-[spin_4s_linear_infinite] origin-center opacity-60 rounded-full ${isLoRa ? 'bg-gradient-to-r from-transparent via-purple-500/10 to-transparent' : 'bg-gradient-to-r from-transparent via-blue-500/10 to-transparent'}`} style={{ background: `conic-gradient(from 0deg, transparent 0deg, ${isLoRa ? 'rgba(168, 85, 247, 0.3)' : 'rgba(59, 130, 246, 0.3)'} 60deg, transparent 60deg)` }}></div>
                  <div className="absolute flex flex-col items-center justify-center z-10">
                    <div className="w-24 h-24 border border-red-500/50 rounded-full absolute animate-ping"></div>
                    <div className="w-16 h-16 border-2 border-red-500/80 rounded-full absolute"></div>
                    <div className="w-[100vw] h-px bg-red-500/30 absolute"></div>
                    <div className="w-px h-[100vh] bg-red-500/30 absolute"></div>
                    <div className="w-3 h-3 bg-red-500 rounded-full z-10 shadow-[0_0_15px_#ef4444]"></div>
                    <div className="absolute top-12 bg-black/80 border border-red-900 px-3 py-1.5 text-[10px] text-white font-bold whitespace-nowrap rounded shadow-2xl">
                      OBJ: {activeResponderAlert.roomId}
                    </div>
                  </div>
               </div>
            </div>
            <div className="bg-black/90 border-t border-slate-800 p-2 text-[9px] text-slate-500 flex justify-between z-20 shrink-0">
              <span className="truncate mr-2 font-mono text-blue-400">LAT/LNG: {activeVenue.lat}, {activeVenue.lng}</span>
              <span className="shrink-0 text-slate-600">ENC: AES-256</span>
            </div>
          </div>
        </div>
      </div>
    );
  };

  // --- Main Render Engine ---
  return (
    <div className="h-screen w-full bg-slate-900 text-slate-900 flex flex-col overflow-hidden">
      {currentRole === 'portal' && <Portal />}
      {currentRole === 'admin' && <AdminSettings />}
      {currentRole === 'guest' && <GuestInterface />}
      {currentRole === 'staff' && <StaffDashboard />}
      {currentRole === 'responder' && <ResponderView />}
    </div>
  );
}