import { useState, useEffect, useCallback, useRef } from 'react';
import { GoogleGenAI, ThinkingLevel } from "@google/genai";
import { motion, AnimatePresence } from "motion/react";
import { DotLottieReact } from '@lottiefiles/dotlottie-react';
import { Quote, RefreshCw, Share2, Heart, BookOpen, Sun, Sparkles, Palette, Moon, ListFilter, Check, Volume2, Copy, Download, X, LogIn, LogOut, User, HelpCircle, Menu, Settings2, MessageCircle, Send, MessageSquareQuote, Flame, Trophy, Zap } from 'lucide-react';
import { NEW_TESTAMENT_VERSES } from './verses.ts';
import { auth, db, signIn, logOut } from './lib/firebase';
import { onAuthStateChanged, User as FirebaseUser } from 'firebase/auth';
import { 
  collection, 
  query, 
  where, 
  onSnapshot, 
  addDoc, 
  deleteDoc, 
  doc, 
  serverTimestamp,
  getDoc,
  setDoc,
  updateDoc,
  increment
} from 'firebase/firestore';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

interface Reflection {
  title: string;
  body: string;
  actions: string[];
}

interface Stats {
  currentStreak: number;
  totalActions: number;
  lastActiveDate: string;
}

interface FirestoreErrorInfo {
  error: string;
  operationType: 'create' | 'update' | 'delete' | 'list' | 'get' | 'write';
  path: string | null;
  authInfo: {
    userId: string;
    email: string;
    emailVerified: boolean;
    isAnonymous: boolean;
    providerInfo: { providerId: string; displayName: string; email: string; }[];
  }
}

const handleFirestoreError = (err: any, operationType: FirestoreErrorInfo['operationType'], path: string | null = null) => {
  console.error(`Firestore Error [${operationType}] at ${path}:`, err);
  
  if (err.message.includes('insufficient permissions')) {
    const errorInfo: FirestoreErrorInfo = {
      error: err.message,
      operationType,
      path,
      authInfo: {
        userId: auth.currentUser?.uid || 'guest',
        email: auth.currentUser?.email || 'N/A',
        emailVerified: auth.currentUser?.emailVerified || false,
        isAnonymous: auth.currentUser?.isAnonymous || false,
        providerInfo: auth.currentUser?.providerData.map(p => ({
          providerId: p.providerId,
          displayName: p.displayName || 'N/A',
          email: p.email || 'N/A'
        })) || []
      }
    };
    throw new Error(JSON.stringify(errorInfo));
  }
  throw err;
};

const THEMES = [
  { category: "Todos", books: "Nuevo Testamento y Salmos", ids: ["JHN", "MAT", "ROM", "HEB", "PSA", "PHP", "1TH", "COL", "JAS", "1PE", "1JN", "EPH", "2TI", "2TH", "GAL", "1CO", "2CO", "LUK", "REV", "ACT", "MRK", "1TI", "TIT"] },
  { category: "Fe", books: "Juan, Mateo, Romanos, Hebreos, Gálatas", ids: ["JHN", "MAT", "ROM", "HEB", "GAL", "EPH", "ACT"] },
  { category: "Esperanza", books: "Romanos, 2 Timoteo, 2 Tesalonicenses, 1 Pedro, Apocalipsis, Salmos", ids: ["ROM", "2TI", "2TH", "1PE", "COL", "REV", "PSA"] },
  { category: "Amor", books: "1 Juan, 1 Corintios, Efesios, Juan, 1 Pedro", ids: ["1JN", "1CO", "EPH", "JHN", "1PE", "1JN"] },
  { category: "Paz", books: "Filipenses, Juan, Romanos, Colosenses, Salmos", ids: ["PHP", "JHN", "ROM", "MAT", "2TH", "COL", "PSA"] },
  { category: "Fortaleza", books: "2 Timoteo, Filipenses, Santiago, 2 Corintios, Salmos, Isaías", ids: ["2TI", "PHP", "JAS", "1PE", "MAT", "2CO", "PSA"] },
  { category: "Sabiduría", books: "Santiago, Colosenses, Lucas, Efesios, 1 Corintios", ids: ["JAS", "COL", "EPH", "1CO", "MAT", "ROM", "LUK", "1TI"] },
  { category: "Gratitud", books: "Salmos, Filipenses, 1 Tesalonicenses, Colosenses", ids: ["PSA", "PHP", "1TH", "COL"] }
];

const PALETTES = [
  { id: 'calido', name: 'Alba', preview: ['#fdf8f4', '#431407', '#c2410c'] },
  { id: 'oceano', name: 'Pacífico', preview: ['#f0f7ff', '#0c4a6e', '#0369a1'] },
  { id: 'bosque', name: 'Reserva', preview: ['#f2f4f2', '#064e3b', '#047857'] },
  { id: 'misterio', name: 'Abismo', preview: ['#18122b', '#f5f3ff', '#8b5cf6'] },
  { id: 'dark', name: 'Penumbra', preview: ['#080808', '#f5f5f5', '#d4d4d8'] },
];

export default function App() {
  const [verse, setVerse] = useState(NEW_TESTAMENT_VERSES[0]);
  const [reflection, setReflection] = useState<Reflection | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [offset, setOffset] = useState(0);
  const [selectedCategory, setSelectedCategory] = useState<string>("Fe");
  
  // UX States
  const [theme, setTheme] = useState(() => localStorage.getItem('ilumina-theme') || 'calido');
  const [favorites, setFavorites] = useState<any[]>([]);
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [showThemes, setShowThemes] = useState(false);
  const [showFavorites, setShowFavorites] = useState(false);
  const [showShare, setShowShare] = useState(false);
  const [showInfo, setShowInfo] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const [showChat, setShowChat] = useState(false);
  const [chatMessages, setChatMessages] = useState<{ role: 'user' | 'model', content: string }[]>([]);
  const [chatLoading, setChatLoading] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [navVisible, setNavVisible] = useState(true);
  const [lastScrollY, setLastScrollY] = useState(0);
  const [completedActions, setCompletedActions] = useState<Record<string, boolean>>({});
  const [stats, setStats] = useState<Stats>({
    currentStreak: 0,
    totalActions: 0,
    lastActiveDate: ''
  });
  const [seenVerses, setSeenVerses] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem('ilumina-history') || '[]');
    } catch {
      return [];
    }
  });
  const lastVerseRef = useRef<string | null>(null);

  // Auto-hide navigation logic
  useEffect(() => {
    const handleScroll = () => {
      const currentScrollY = window.scrollY;
      if (currentScrollY > 100) {
        if (currentScrollY > lastScrollY) {
          setNavVisible(false);
        } else {
          setNavVisible(true);
        }
      } else {
        setNavVisible(true);
      }
      setLastScrollY(currentScrollY);
    };

    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, [lastScrollY]);

  // Animation variants
  const drawerVariants = {
    closed: { x: '100%', transition: { type: 'spring', damping: 30, stiffness: 300 } },
    open: { x: 0, transition: { type: 'spring', damping: 25, stiffness: 200, staggerChildren: 0.1, delayChildren: 0.2 } }
  };

  const itemVariants = {
    closed: { opacity: 0, x: 20 },
    open: { opacity: 1, x: 0 }
  };

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (u) => {
      setUser(u);
      if (u) {
        // Sync stats from Firestore
        const statsRef = doc(db, 'stats', u.uid);
        const statsSnap = await getDoc(statsRef);
        
        const today = new Date().toISOString().split('T')[0];
        
        if (statsSnap.exists()) {
          const data = statsSnap.data() as Stats;
          let newStreak = data.currentStreak;
          const lastDate = data.lastActiveDate;
          
          if (lastDate !== today) {
            const yesterday = new Date();
            yesterday.setDate(yesterday.getDate() - 1);
            const yesterdayStr = yesterday.toISOString().split('T')[0];
            
            if (lastDate === yesterdayStr) {
              newStreak += 1;
            } else {
              newStreak = 1;
            }
            
            await setDoc(statsRef, {
              ...data,
              currentStreak: newStreak,
              lastActiveDate: today,
              updatedAt: serverTimestamp()
            });
            setStats({ ...data, currentStreak: newStreak, lastActiveDate: today });
          } else {
            setStats(data);
          }
        } else {
          // Initialize stats
          const initialStats = {
            userId: u.uid,
            currentStreak: 1,
            totalActions: 0,
            lastActiveDate: today,
            updatedAt: serverTimestamp()
          };
          await setDoc(statsRef, initialStats);
          setStats({ currentStreak: 1, totalActions: 0, lastActiveDate: today });
        }
      } else {
        // Fallback to localStorage for guests
        const localStats = JSON.parse(localStorage.getItem('ilumina-stats') || 'null');
        const today = new Date().toISOString().split('T')[0];
        
        if (localStats) {
          let newStreak = localStats.currentStreak;
          const lastDate = localStats.lastActiveDate;
          
          if (lastDate !== today) {
            const yesterday = new Date();
            yesterday.setDate(yesterday.getDate() - 1);
            const yesterdayStr = yesterday.toISOString().split('T')[0];
            
            if (lastDate === yesterdayStr) {
              newStreak += 1;
            } else {
              newStreak = 1;
            }
            
            const updatedStats = { ...localStats, currentStreak: newStreak, lastActiveDate: today };
            localStorage.setItem('ilumina-stats', JSON.stringify(updatedStats));
            setStats(updatedStats);
          } else {
            setStats(localStats);
          }
        } else {
          const initialStats = { currentStreak: 1, totalActions: 0, lastActiveDate: today };
          localStorage.setItem('ilumina-stats', JSON.stringify(initialStats));
          setStats(initialStats);
        }
        
        const localFavs = JSON.parse(localStorage.getItem('ilumina-favorites') || '[]');
        setFavorites(localFavs);
      }
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!user) return;
    
    const q = query(collection(db, "favorites"), where("userId", "==", user.uid));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const favs = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      setFavorites(favs);
    }, (error) => {
      try {
        handleFirestoreError(error, 'list', 'favorites');
      } catch (formattedError: any) {
        setError("Error de sincronización. Verifica tu conexión o permisos.");
        console.error(formattedError.message);
      }
    });

    return () => unsubscribe();
  }, [user]);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('ilumina-theme', theme);
  }, [theme]);

  useEffect(() => {
    if (showChat) {
      const chatBottom = document.getElementById('chat-bottom');
      chatBottom?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [chatMessages, showChat]);

  const handleActionToggle = async (action: string) => {
    const isNowCompleted = !completedActions[action];
    setCompletedActions(prev => ({ ...prev, [action]: isNowCompleted }));
    
    if (isNowCompleted) {
      if (user) {
        const statsRef = doc(db, 'stats', user.uid);
        await updateDoc(statsRef, {
          totalActions: increment(1),
          updatedAt: serverTimestamp()
        });
      } else {
        const localStats = JSON.parse(localStorage.getItem('ilumina-stats') || '{"currentStreak": 1, "totalActions": 0, "lastActiveDate": ""}');
        localStats.totalActions += 1;
        localStorage.setItem('ilumina-stats', JSON.stringify(localStats));
      }
      setStats(prev => ({ ...prev, totalActions: prev.totalActions + 1 }));
    }
  };

  const handleSendMessage = async (userMessage: string) => {
    if (!userMessage.trim() || chatLoading || !reflection) return;

    const newMessages = [...chatMessages, { role: 'user' as const, content: userMessage }];
    setChatMessages(newMessages);
    setChatLoading(true);

    try {
      const history = chatMessages.map(m => ({ 
        role: m.role, 
        parts: [{ text: m.content }] 
      }));

      const systemInstruction = `IDENTIDAD: Eres el Mentor de iLumina. Eres un Guía Espiritual sabio, compasivo y directo.
CONTEXTO ACTUAL:
- Versículo: "${verse.text}" (${verse.reference})
- Reflexión: "${reflection.title}"
- Contenido: "${reflection.body}"

TU MISIÓN: Ayudar al usuario a profundizar en este mensaje específico.
REGLAS:
1. Mantén la voz en SEGUNDA PERSONA (tú).
2. Sé conciso pero profundo (máximo 100-150 palabras por respuesta).
3. Si te preguntan algo fuera del contexto espiritual o de la reflexión, redirige suavemente la conversación hacia el crecimiento personal y el mensaje bíblico.
4. Usa un tono que inspire paz y claridad.`;

      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: [
          ...history,
          { role: 'user', parts: [{ text: userMessage }] }
        ],
        config: { 
          systemInstruction,
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW }
        }
      });

      if (response.text) {
        setChatMessages([...newMessages, { role: 'model', content: response.text }]);
      }
    } catch (err) {
      console.error("Chat error:", err);
      setChatMessages([...newMessages, { role: 'model', content: "Lo siento, mi conexión con la sabiduría se ha interrumpido momentáneamente. ¿Podrías repetirme tu inquietud?" }]);
    } finally {
      setChatLoading(false);
    }
  };

  const getDayOfYear = () => {
    const now = new Date();
    const start = new Date(now.getFullYear(), 0, 0);
    const diff = now.getTime() - start.getTime();
    const oneDay = 1000 * 60 * 60 * 24;
    return Math.floor(diff / oneDay) + offset;
  };

  const generateReflection = useCallback(async () => {
    setLoading(true);
    setError(null);
    if (isSpeaking) window.speechSynthesis.cancel();
    setIsSpeaking(false);
    
    try {
      const dayOfYear = getDayOfYear();
      
      // Removed daily stable cache to ensure every generation is fresh as per user request
      const formattedDate = new Date().toLocaleDateString('es-ES', { 
        weekday: 'long', 
        year: 'numeric', 
        month: 'long', 
        day: 'numeric' 
      });

      let themeInfo = THEMES.find(t => t.category === selectedCategory) || THEMES[0];
      
      // If "Todos" is selected, pick a random category from the others for this generation
      if (selectedCategory === "Todos") {
        const otherThemes = THEMES.filter(t => t.category !== "Todos");
        themeInfo = otherThemes[Math.floor(Math.random() * otherThemes.length)];
      }
      
      let selectedVerse = null;
      let attempts = 0;
      
      while (!selectedVerse && attempts < 5) {
        attempts++;
        try {
          // Dynamic fetch from esbiblia.net API
          const randomBookId = themeInfo.ids[Math.floor(Math.random() * themeInfo.ids.length)];
          // Add a random seed to attempt avoiding cache
          const seed = Math.random().toString(36).substring(7);
          const apiResponse = await fetch(`https://esbiblia.net/api/random/${randomBookId}/?v=RVR1960&r=${seed}`);
          
          if (!apiResponse.ok) throw new Error('API Unavailable');
          
          const data = await apiResponse.json();
          if (data && data.verses && data.verses.length > 0) {
            const v = data.verses[0];
            const ref = `${v.book_id} ${v.chapter}:${v.verse} (RVR1960)`;
            
            // Check if it's already seen or the same as the last one
            if ((!seenVerses.includes(ref) && ref !== lastVerseRef.current) || attempts === 5) {
              selectedVerse = {
                text: v.text,
                reference: ref
              };
              lastVerseRef.current = ref;
            }
          } else {
            throw new Error('Empty API response');
          }
        } catch (apiErr) {
          console.warn(`esBiblia API try ${attempts} failed:`, apiErr);
          if (attempts >= 5) {
            // Fallback to local NEW_TESTAMENT_VERSES
            const allowedBooks = themeInfo.books.split(', ').map(b => b.toLowerCase());
            const filteredVerses = NEW_TESTAMENT_VERSES.filter(v => 
              allowedBooks.some(book => v.reference.toLowerCase().includes(book))
            );
            const pool = filteredVerses.length > 0 ? filteredVerses : NEW_TESTAMENT_VERSES;
            
            // Avoid repeating already seen verses if possible
            let availablePool = pool.filter(v => !seenVerses.includes(v.reference));
            if (availablePool.length === 0) {
              availablePool = pool; // Reset if all seen
              setSeenVerses([]); // Clear history
            }
            
            const fallbackVerse = availablePool[Math.floor(Math.random() * availablePool.length)];
            selectedVerse = fallbackVerse;
          }
        }
      }
      
      if (!selectedVerse) throw new Error('Could not fetch verse after multiple attempts');
      
      setVerse(selectedVerse);
      
      // Update history
      setSeenVerses(prev => {
        const next = [selectedVerse!.reference, ...prev].slice(0, 50);
        localStorage.setItem('ilumina-history', JSON.stringify(next));
        return next;
      });
      
      const prompt = `IDENTIDAD: Eres un Mentor Espiritual y Consejero de Vida con profundo conocimiento bíblico y de psicología humanista. Integras sabiduría de grandes pensadores como Viktor Frankl, Carl Rogers, Abraham Maslow y Brené Brown. Traduces verdades bíblicas en estrategias de vida inmediatas.

CONTEXTO: Hoy es ${formattedDate}. 
El Evangelio del día es ${selectedVerse.reference}.

REGLA CRÍTICA DE VOZ:
- SIEMPRE habla en SEGUNDA PERSONA (tú). Dirígete al lector directamente.
- NUNCA uses primera persona (yo, me, mi). NO narres experiencias propias.

TU FORMA DE HABLAR:
- Palabras simples que un niño de 12 años entienda.
- Frases cortas, directas y poderosas.
- Ejemplos de la vida real (trabajo, familia, amigos, dinero, estrés, salud mental).

NUNCA empieces con: 
"En el torbellino...", "En medio del caos...", "En la vorágine...", 
"En el mundo actual...", "Hoy más que nunca..."

FORMATO (3 PARTES separadas por líneas en blanco, SIN TÍTULOS):

PARTE 1 - MEDITACIÓN DEL EVANGELIO (400-500 palabras, MÍNIMO 4 párrafos):
1. DIAGNÓSTICO VITAL: Abre con una escena cotidiana muy concreta y reconocible (el atasco de la mañana, el mensaje que no contestas, la reunión que te agota, la cena en silencio con tu pareja, el scroll infinito antes de dormir, la comparación con un compañero de trabajo). Nombra una emoción real que el lector está sintiendo HOY (cansancio, envidia, miedo, vacío, urgencia, soledad rodeada de gente).
2. PUENTE TEOLÓGICO: Introduce el Evangelio en su contexto litúrgico y narrativo. Explica QUIÉN habla, A QUIÉN, y QUÉ está pasando alrededor de Jesús. Si hay una palabra clave que ilumine el texto, menciónala con sencillez. Conecta esa escena antigua con la escena moderna del diagnóstico.
3. APLICACIÓN TRANSFORMADORA: Aterriza el mensaje en áreas concretas de la vida diaria: trabajo y carrera, relaciones de pareja, paternidad/maternidad, amistades, dinero, redes sociales, salud mental, descanso, hábitos digitales. Da al menos DOS ejemplos prácticos de cómo este Evangelio cambia tu manera de actuar HOY en situaciones reales (cómo respondes un email difícil, cómo escuchas a tu hijo, cómo gestionas una crítica, cómo dejas el móvil). Confronta suavemente las falsas narrativas culturales (productividad tóxica, perfeccionismo, éxito = valor, hiperconexión).
4. EL CAMBIO REAL: Cierra con una invitación poderosa y específica. Visualiza cómo será tu tarde, tu cena, tu conversación de esta noche o tu mañana de mañana si vives este Evangelio en serio.

PARTE 2 - 3 COSAS PARA HACER HOY (texto corrido):
3 micro-acciones con verbos de acción para las próximas 24 horas. 
Texto corrido separado por puntos. Sin números ni viñetas.

PARTE 3 - ORACIÓN:
Empieza con "Señor," - Una oración honesta conectada con el Evangelio del día. Termina con "Amén."

REGLAS ABSOLUTAS:
- SIEMPRE segunda persona (tú). Tutea siempre.
- PROHIBIDO: números, negritas, viñetas, títulos, líneas decorativas, separadores, encabezados.
- Solo texto plano con párrafos separados por líneas en blanco.

Versículo en el que basar la reflexión: "${selectedVerse.text}" (${selectedVerse.reference})

Respuesta estrictamente en formato JSON:
{
  "title": "Un título breve y directo de 2-4 palabras",
  "body": "El contenido siguiendo estrictamente el formato de las 3 partes (párrafos separados por líneas en blanco, sin títulos ni viñetas)",
  "actions": ["Acción 1 directa", "Acción 2 directa", "Acción 3 directa"]
}`;

      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: prompt,
        config: { 
          responseMimeType: "application/json"
        }
      });

      const text = response.text;
      if (text) {
        // Sanitize response to extract JSON
        let jsonStr = text.trim();
        
        // Find the first '{' and attempt to find a valid JSON object starting there
        const start = jsonStr.indexOf('{');
        if (start !== -1) {
          // Attempt to find the last '}' and work backwards if parsing fails
          let end = jsonStr.lastIndexOf('}');
          while (end > start) {
            const candidate = jsonStr.substring(start, end + 1);
            try {
              const parsedReflection = JSON.parse(candidate);
              setReflection(parsedReflection);
              setCompletedActions({});
              setChatMessages([]);
              return; // Success!
            } catch (e) {
              // Try the next '}' backwards
              end = jsonStr.lastIndexOf('}', end - 1);
            }
          }
        }
        
        // Final fallback attempt with the original string if the loop didn't succeed
        try {
          const parsedReflection = JSON.parse(jsonStr);
          setReflection(parsedReflection);
          setCompletedActions({});
          setChatMessages([]);
        } catch (parseError) {
          console.error("JSON parsing error:", parseError, "Raw text:", text);
          setError("Error al procesar la respuesta. Reintentando...");
        }
      }
    } catch (err: any) {
      console.error(err);
      const errorMessage = err?.message || '';
      const errorCode = err?.status || err?.error?.code || 0;
      
      if (errorCode === 429 || errorMessage.includes('429') || errorMessage.toLowerCase().includes('quota') || errorMessage.toLowerCase().includes('resource_exhausted')) {
        setError("Se ha alcanzado el límite de uso gratuito de la IA. Por favor, intenta de nuevo en unos minutos o mañana.");
      } else {
        setError("Algo salió mal. Inténtalo de nuevo.");
      }
    } finally {
      setLoading(false);
    }
  }, [offset, selectedCategory]);

  // Initial generation on mount
  useEffect(() => {
    generateReflection();
  }, []);

  const toggleFavorite = async () => {
    if (!reflection) return;
    const isFav = favorites.find(f => f.verseReference === verse.reference && f.reflectionTitle === reflection.title);
    
    if (isFav) {
      if (user) {
        try {
          await deleteDoc(doc(db, "favorites", isFav.id));
        } catch (e: any) {
          handleFirestoreError(e, 'delete', `favorites/${isFav.id}`);
        }
      } else {
        const newFavs = favorites.filter(f => f.verseReference !== verse.reference);
        setFavorites(newFavs);
        localStorage.setItem('ilumina-favorites', JSON.stringify(newFavs));
      }
    } else {
      const newFav = {
        userId: user?.uid || 'guest',
        verseText: verse.text,
        verseReference: verse.reference,
        reflectionTitle: reflection.title,
        reflectionBody: reflection.body,
        category: selectedCategory,
        createdAt: user ? serverTimestamp() : new Date().toISOString()
      };

      if (user) {
        try {
          await addDoc(collection(db, "favorites"), newFav);
        } catch (e: any) {
          handleFirestoreError(e, 'create', 'favorites');
          setError("Inicia sesión para guardar en la nube.");
        }
      } else {
        const newFavs = [...favorites, newFav];
        setFavorites(newFavs);
        localStorage.setItem('ilumina-favorites', JSON.stringify(newFavs));
      }
    }
  };

  const isCurrentFavorite = reflection && favorites.some(f => f.verseReference === verse.reference && f.reflectionTitle === reflection.title);

  const speak = () => {
    if (!reflection) return;
    if (isSpeaking) {
      window.speechSynthesis.cancel();
      setIsSpeaking(false);
      return;
    }
    const utterance = new SpeechSynthesisUtterance(`${verse.text}. ${reflection.title}. ${reflection.body}`);
    utterance.lang = 'es-ES';
    utterance.onend = () => setIsSpeaking(false);
    setIsSpeaking(true);
    window.speechSynthesis.speak(utterance);
  };

  const copyToClipboard = () => {
    const text = `"${verse.text}" (${verse.reference})\n\n${reflection?.title}\n\n${reflection?.body}\n\niLumina App`;
    navigator.clipboard.writeText(text);
    alert("¡Copiado al portapapeles!");
  };

  return (
    <div className="min-h-screen theme-transition flex flex-col selection:bg-[var(--text-main)] selection:text-[var(--bg-app)]">
      <div className="atmosphere" />
      
      {/* Refined Navigation */}
      <motion.nav 
        initial={{ y: -100 }}
        animate={{ y: navVisible ? 0 : -100 }}
        className="fixed top-0 left-0 right-0 z-[100] nav-blur flex items-center"
      >
        <div className="max-w-5xl mx-auto px-8 pt-[calc(var(--safe-top)+1.5rem)] pb-6 w-full flex justify-between items-center font-display">
          <div 
            className="flex items-center cursor-pointer group"
            onClick={() => { setShowFavorites(false); setShowInfo(false); setShowMenu(false); setOffset(0); }}
          >
            <div className="flex flex-col">
              <h1 className="text-sm font-extrabold tracking-[0.4em] uppercase leading-none">iLumina</h1>
              <span className="text-[9px] uppercase tracking-widest opacity-40 mt-1 font-sans">IA Espiritual</span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button 
              onClick={() => setShowMenu(true)}
              className="w-12 h-12 flex items-center justify-center rounded-full glass-card hover:bg-[var(--line)] transition-all group"
            >
              <Menu size={20} className="group-hover:scale-110 transition-transform" />
            </button>
          </div>
        </div>
      </motion.nav>

      {/* Polished Side Drawer Menu */}
      <AnimatePresence>
        {showMenu && (
          <>
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowMenu(false)}
              className="fixed inset-0 z-[200] bg-black/40 backdrop-blur-md"
            />
            <motion.div 
              variants={drawerVariants}
              initial="closed"
              animate="open"
              exit="closed"
              className="fixed top-0 right-0 bottom-0 z-[210] w-full max-w-sm bg-[var(--bg-app)] shadow-2xl border-l border-[var(--line)] flex flex-col overflow-hidden"
            >
              <header className="pt-[calc(var(--safe-top)+2.5rem)] pb-8 px-10 flex justify-between items-center bg-[var(--bg-app)] border-b border-[var(--line)] sticky top-0 z-10">
                <motion.div variants={itemVariants} className="flex items-center gap-5">
                  <div className="w-14 h-14 rounded-full border border-[var(--line)] flex items-center justify-center text-[var(--text-main)] shadow-xl shadow-[var(--text-main)]/5 animate-pulse-subtle overflow-hidden">
                    <img src="https://cdn-icons-png.flaticon.com/512/4676/4676848.png" alt="Logo" className={`w-8 h-8 object-contain ${theme === 'dark' || theme === 'misterio' ? 'brightness-200 drop-shadow-[0_0_10px_rgba(255,255,255,0.5)]' : ''}`} />
                  </div>
                  <div className="flex flex-col">
                    <h2 className="text-xl font-display font-bold uppercase tracking-[0.2em] text-[var(--text-main)]">Menu</h2>
                    <span className="text-[9px] uppercase tracking-widest opacity-40 font-bold">Exploración Sagrada</span>
                  </div>
                </motion.div>
                <motion.button 
                  variants={itemVariants}
                  whileHover={{ scale: 1.1, rotate: 90 }}
                  whileTap={{ scale: 0.9 }}
                  onClick={() => setShowMenu(false)}
                  className="w-12 h-12 flex items-center justify-center rounded-full glass-card hover:bg-[var(--line)] transition-all"
                >
                  <X size={24} />
                </motion.button>
              </header>

              <div className="flex-grow overflow-y-auto px-8 py-12 no-scrollbar space-y-16">
                {/* Section: Principal */}
                <section className="space-y-6">
                  <motion.p variants={itemVariants} className="text-[9px] uppercase tracking-[0.5em] font-bold text-[var(--text-muted)] text-center">Navegación Vital</motion.p>
                  <div className="space-y-3">
                    <motion.button 
                      variants={itemVariants}
                      whileHover={{ x: 8 }}
                      onClick={() => { setShowMenu(false); setShowFavorites(true); setShowInfo(false); }}
                      className={`w-full flex items-center justify-between p-6 rounded-[2rem] transition-all group ${showFavorites ? 'bg-[var(--text-main)] text-[var(--bg-app)] shadow-2xl' : 'hover:bg-[var(--surface-bg)] text-[var(--text-main)]'}`}
                    >
                      <div className="flex items-center gap-5">
                        <Heart size={20} fill={showFavorites ? "currentColor" : "none"} />
                        <span className="text-sm font-bold tracking-widest uppercase">Favoritos</span>
                      </div>
                      <span className="text-[10px] font-bold opacity-30">{favorites.length}</span>
                    </motion.button>

                    <motion.button 
                      variants={itemVariants}
                      whileHover={{ x: 8 }}
                      onClick={() => { setShowMenu(false); setShowInfo(true); setShowFavorites(false); }}
                      className={`w-full flex items-center gap-5 p-6 rounded-[2rem] transition-all group ${showInfo ? 'bg-[var(--text-main)] text-[var(--bg-app)] shadow-2xl' : 'hover:bg-[var(--surface-bg)] text-[var(--text-main)]'}`}
                    >
                      <BookOpen size={20} />
                      <span className="text-sm font-bold tracking-widest uppercase">Manifiesto</span>
                    </motion.button>
                  </div>
                </section>

                {/* Section: Transformation */}
                <section className="space-y-6">
                  <motion.p variants={itemVariants} className="text-[9px] uppercase tracking-[0.5em] font-bold text-[var(--text-muted)] text-center">Ruta de Transformación</motion.p>
                  
                  <motion.div variants={itemVariants} className="grid grid-cols-2 gap-4">
                    <div className="glass-card rounded-[2.5rem] p-8 flex flex-col items-center justify-center text-center gap-4 bg-[var(--surface-bg)]">
                      <div className="relative">
                        <div className="absolute inset-0 bg-orange-400/20 blur-xl rounded-full" />
                        <div className="relative w-12 h-12 rounded-full border border-orange-400/30 flex items-center justify-center text-orange-500">
                          <Zap size={24} />
                        </div>
                      </div>
                      <div>
                        <p className="text-3xl font-display font-extrabold text-[var(--text-main)] leading-none">{stats.currentStreak}</p>
                        <p className="text-[8px] uppercase tracking-[0.2em] font-bold text-[var(--text-muted)] mt-2">Días</p>
                      </div>
                    </div>
                    
                    <div className="glass-card rounded-[2.5rem] p-8 flex flex-col items-center justify-center text-center gap-4 bg-[var(--surface-bg)]">
                      <div className="relative">
                        <div className="absolute inset-0 bg-blue-400/20 blur-xl rounded-full" />
                        <div className="relative w-12 h-12 rounded-full border border-blue-400/30 flex items-center justify-center text-blue-500">
                          <Check size={24} strokeWidth={3} />
                        </div>
                      </div>
                      <div>
                        <p className="text-3xl font-display font-extrabold text-[var(--text-main)] leading-none">{stats.totalActions}</p>
                        <p className="text-[8px] uppercase tracking-[0.2em] font-bold text-[var(--text-muted)] mt-2">Logros</p>
                      </div>
                    </div>
                  </motion.div>
                </section>

                {/* Section: Aesthetic */}
                <section className="space-y-8">
                  <motion.p variants={itemVariants} className="text-[9px] uppercase tracking-[0.5em] font-bold text-[var(--text-muted)] text-center">Ecos de Luz</motion.p>
                  
                  <motion.div variants={itemVariants} className="space-y-4">
                    {PALETTES.map(p => (
                      <button 
                        key={p.id}
                        onClick={() => setTheme(p.id)}
                        className={`w-full flex items-center justify-between p-6 rounded-[2.5rem] border transition-all duration-700 ${theme === p.id ? 'bg-[var(--text-main)] text-[var(--bg-app)] border-transparent shadow-2xl' : 'glass-card hover:bg-[var(--line)] border-[var(--line)]'}`}
                      >
                        <div className="flex items-center gap-5">
                          <div className="flex -space-x-3">
                            {p.preview.map((color, idx) => (
                              <div key={idx} className="w-6 h-6 rounded-full border-2 border-[var(--bg-app)] shadow-sm" style={{ backgroundColor: color, zIndex: 3-idx }} />
                            ))}
                          </div>
                          <span className="text-[10px] font-bold uppercase tracking-widest">{p.name}</span>
                        </div>
                        {theme === p.id && <Check size={14} strokeWidth={4} />}
                      </button>
                    ))}
                  </motion.div>
                </section>
              </div>

              <footer className="p-10 border-t border-[var(--line)] space-y-8">
                <motion.button 
                  variants={itemVariants}
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={() => { user ? logOut() : signIn(); setShowMenu(false); }}
                  className="w-full py-6 bg-[var(--text-main)] text-[var(--bg-app)] rounded-full text-[10px] font-extrabold uppercase tracking-[0.3em] flex items-center justify-center gap-4 shadow-2xl"
                >
                  {user ? <LogOut size={16} /> : <LogIn size={16} />}
                  {user ? 'Finalizar' : 'Acceder'}
                </motion.button>
              </footer>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Main Container with generous spacing */}
      <div className="mt-[calc(var(--safe-top)+7rem)] flex-grow flex flex-col">
        <div className="max-w-2xl mx-auto w-full px-6 flex-grow pb-32">
          
          <AnimatePresence mode="wait">
            {showInfo ? (
              <motion.div 
                key="info"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="glass-card rounded-[3rem] p-12 md:p-20 space-y-16 mb-20"
              >
                <header className="space-y-6">
                  <div className="w-16 h-16 rounded-full border border-[var(--line)] flex items-center justify-center text-[var(--text-main)] mb-10 shadow-xl shadow-[var(--text-main)]/5">
                    <BookOpen size={24} />
                  </div>
                  <h2 className="text-4xl md:text-6xl font-display font-black leading-none text-[var(--text-main)] tracking-tighter italic">Manifiesto iLumina</h2>
                  <p className="text-[10px] uppercase tracking-[0.8em] font-bold text-[var(--text-muted)] opacity-50 text-center md:text-left">Sabiduría Sagrada para el Mundo Moderno</p>
                </header>
                
                <div className="prose prose-stone prose-xl font-serif text-[var(--text-main)]/80 leading-relaxed italic space-y-10">
                  <p>iLumina no es simplemente una aplicación; es un santuario personal en la palma de tu mano. En un mundo saturado de ruido y distraiciones, hemos creado un espacio donde la sabiduría milenaria se encuentra con la inteligencia artificial para guiarte en tu camino espiritual cotidiano.</p>
                  <p>Nuestro propósito es traducir las verdades eternas en acciones tangibles. No buscamos solo que leas, sino que sientas y apliques la luz que emana de cada palabra, sintonizando tu corazón con frecuencias de paz, esperanza y amor.</p>
                </div>

                <div className="pt-12 border-t border-[var(--line)] flex flex-col md:flex-row justify-between items-center gap-10">
                  <div className="flex flex-col items-center md:items-start">
                    <p className="text-[10px] uppercase tracking-widest font-bold opacity-30 mb-2">Dirección Creativa</p>
                    <p className="text-sm font-bold tracking-tight">Javier Acisclo</p>
                  </div>
                  <button 
                    onClick={() => setShowInfo(false)}
                    className="px-12 py-6 bg-[var(--text-main)] text-[var(--bg-app)] rounded-full text-[10px] font-extrabold uppercase tracking-[0.3em] shadow-2xl active:scale-95 transition-all"
                  >
                    Regresar al flujo
                  </button>
                </div>
              </motion.div>
            ) : showFavorites ? (
              <motion.div 
                key="favorites"
                initial={{ opacity: 0, y: 30 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -30 }}
                className="space-y-12"
              >
                <header className="flex flex-col md:flex-row justify-between items-end border-b border-[var(--line)] pb-12 gap-8">
                  <div className="space-y-4 text-center md:text-left">
                    <p className="text-[10px] uppercase tracking-[0.5em] font-bold text-[var(--text-muted)]">Repositorio Sagrado</p>
                    <h2 className="text-4xl md:text-5xl font-display font-black tracking-tight italic text-[var(--text-main)] leading-none">Tesoros Guardados</h2>
                  </div>
                  <span className="text-[11px] font-bold opacity-30 tracking-[0.4em] uppercase">{favorites.length} Reflexiones</span>
                </header>

                {favorites.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-40 text-center glass-card rounded-[3rem]">
                    <div className="w-20 h-20 rounded-full border border-[var(--line)] flex items-center justify-center mb-10 opacity-30 shadow-2xl">
                      <Heart size={32} />
                    </div>
                    <p className="text-[10px] uppercase tracking-[0.4em] font-bold opacity-50 italic">Tu altar de sabiduría aún espera su primera luz</p>
                  </div>
                ) : (
                  <div className="grid gap-6">
                    {favorites.map((fav, i) => (
                      <motion.button 
                        key={fav.id || i}
                        initial={{ opacity: 0, y: 20 }}
                        whileInView={{ opacity: 1, y: 0 }}
                        viewport={{ once: true }}
                        transition={{ delay: i * 0.05 }}
                        className="glass-card hover:translate-x-2 transition-all p-10 rounded-[2.5rem] cursor-pointer group text-left w-full flex flex-col md:flex-row gap-10 items-center justify-between"
                        onClick={() => {
                          setVerse({ text: fav.verseText, reference: fav.verseReference });
                          setReflection({ title: fav.reflectionTitle, body: fav.reflectionBody });
                          setShowFavorites(false);
                        }}
                      >
                        <div className="space-y-6 flex-grow">
                          <div className="flex items-center gap-4">
                            <div className="px-5 py-2 bg-[var(--text-main)] text-[var(--bg-app)] rounded-full text-[9px] uppercase tracking-widest font-bold">
                              {fav.category}
                            </div>
                            <time className="text-[10px] font-bold opacity-30 uppercase tracking-widest">
                              {fav.createdAt?.toDate ? fav.createdAt.toDate().toLocaleDateString() : new Date(fav.createdAt).toLocaleDateString()}
                            </time>
                          </div>
                          <h3 className="text-2xl font-serif italic text-[var(--text-main)] group-hover:tracking-wider transition-all duration-700">{fav.reflectionTitle}</h3>
                          <p className="text-sm font-serif italic opacity-60 leading-relaxed border-l-2 border-[var(--line)] pl-6">"{fav.verseText}"</p>
                        </div>
                        <div className="w-12 h-12 rounded-full border border-[var(--line)] flex items-center justify-center text-[var(--text-main)] opacity-0 group-hover:opacity-100 transition-all shrink-0">
                          <RefreshCw size={16} />
                        </div>
                      </motion.button>
                    ))}
                  </div>
                )}
                
                <div className="pt-12 text-center">
                  <button onClick={() => setShowFavorites(false)} className="text-[10px] uppercase tracking-[0.6em] font-bold opacity-30 hover:opacity-100 transition-all underline underline-offset-8 italic">Volver al inicio</button>
                </div>
              </motion.div>
            ) : !loading && reflection ? (
              <motion.main
                key={verse.reference + offset}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
                className="space-y-16"
              >
                {/* Ritual Header Verse */}
                <header className="glass-card p-10 md:p-14 rounded-3xl relative text-center border border-[var(--line)]">
                  <div className="absolute top-0 left-6 right-6 h-px bg-[var(--text-main)] opacity-5" />
                  <Quote className="mx-auto mb-8 text-[var(--accent)]" size={32} />
                  <p className="text-2xl md:text-3xl font-serif italic text-[var(--text-main)] leading-relaxed mb-8">
                    "{verse.text}"
                  </p>
                  <cite className="block text-[10px] uppercase tracking-[0.4em] font-bold text-[var(--text-muted)] not-italic mb-10 border-t border-[var(--line)] pt-8">
                    {verse.reference}
                  </cite>
                  
                  <div className="flex justify-center gap-4">
                    <button onClick={speak} className={`p-4 rounded-full glass-card transition-all ${isSpeaking ? 'bg-[var(--text-main)] text-[var(--bg-app)]' : 'hover:bg-[var(--line)]'}`}>
                      <Volume2 size={18} />
                    </button>
                    <button onClick={toggleFavorite} className={`p-4 rounded-full glass-card transition-all ${isCurrentFavorite ? 'text-red-500' : 'hover:bg-[var(--line)]'}`}>
                      <Heart size={18} fill={isCurrentFavorite ? "currentColor" : "none"} />
                    </button>
                    <button onClick={() => setShowShare(true)} className="p-4 rounded-full glass-card hover:bg-[var(--line)] transition-all">
                      <Share2 size={18} />
                    </button>
                  </div>
                </header>

                {/* (MOVED) Category Selector and Stats now below icons */}
                <div className="space-y-12">
                  {/* Category Selector */}
                  <div className="space-y-6">
                    <p className="text-[10px] uppercase tracking-[0.4em] font-bold text-[var(--text-muted)] text-center italic">Personalizar Reflexión</p>
                    <div className="flex flex-wrap justify-center gap-2">
                      {THEMES.map(t => (
                        <button 
                          key={t.category}
                          onClick={() => { 
                            setSelectedCategory(t.category); 
                            setOffset(prev => prev + 1);
                            generateReflection();
                          }}
                          className={`px-5 py-2 rounded-xl text-[9px] font-bold uppercase tracking-widest transition-all border ${selectedCategory === t.category ? 'bg-[var(--text-main)] text-[var(--bg-app)] border-[var(--text-main)] shadow-xl' : 'text-[var(--text-muted)] border-[var(--line)] hover:border-[var(--text-muted)] hover:bg-[var(--line)]/50'}`}
                        >
                          {t.category}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Status Panel */}
                  {stats.currentStreak > 0 && (
                    <div className="flex justify-center">
                      <div className="glass-card px-8 py-4 rounded-2xl flex items-center gap-6 shadow-xl border border-[var(--line)]">
                        <div className="flex items-center gap-2">
                          <Flame size={14} className="text-orange-500 animate-pulse" />
                          <div className="flex flex-col">
                            <span className="text-[14px] font-black leading-none text-[var(--text-main)] italic">{stats.currentStreak} d</span>
                            <span className="text-[8px] uppercase tracking-widest font-bold opacity-30">Constancia</span>
                          </div>
                        </div>
                        <div className="w-px h-6 bg-[var(--line)]" />
                        <div className="flex items-center gap-2">
                          <Trophy size={14} className="text-yellow-500" />
                          <div className="flex flex-col">
                            <span className="text-[14px] font-black leading-none text-[var(--text-main)] italic">{stats.totalActions}</span>
                            <span className="text-[8px] uppercase tracking-widest font-bold opacity-30">Micro-Acciones</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                {/* Reflection Body */}
                <article className="glass-card rounded-2xl p-8 md:p-16 space-y-12">
                  <header className="space-y-2 pb-8 border-b border-[var(--line)]">
                    <span className="text-[10px] uppercase tracking-[0.4em] font-bold text-[var(--text-muted)]">Palabra de vida</span>
                    <h2 className="text-3xl md:text-5xl font-display font-medium tracking-tight text-[var(--text-main)] leading-[0.95]">
                      {reflection.title}
                    </h2>
                  </header>

                  <div className="prose prose-stone max-w-none prose-lg md:prose-xl font-[Montserrat] text-[var(--text-main)]/90 leading-relaxed selection:bg-[var(--text-main)] selection:text-[var(--bg-app)]">
                    {reflection.body.split(/\n\n+/).map((p, i) => {
                      const trimmed = p.trim();
                      if (!trimmed) return null;
                      
                      const isPrayer = trimmed.startsWith('Señor,') || trimmed.startsWith('Querido Señor') || trimmed.endsWith('Amén.');
                      
                      if (isPrayer) {
                        return (
                          <motion.div 
                            key={i} 
                            initial={{ opacity: 0 }}
                            whileInView={{ opacity: 1 }}
                            viewport={{ once: true }}
                            className="mt-16 mb-8 p-10 rounded-2xl bg-[var(--text-main)] text-[var(--bg-app)] relative group overflow-hidden shadow-2xl"
                          >
                            <div className="absolute top-0 right-0 p-6 opacity-10">
                              <Sparkles size={40} />
                            </div>
                            <h3 className="text-[10px] uppercase tracking-[0.5em] font-bold opacity-50 mb-6 font-display">Petición</h3>
                            <p className="text-xl md:text-2xl italic leading-relaxed selection:bg-[var(--bg-app)] selection:text-[var(--text-main)] m-0 font-[Montserrat]">
                              {trimmed}
                            </p>
                          </motion.div>
                        );
                      }
                      
                      return (
                        <p key={i} className="mb-8 last:mb-0 font-[Montserrat]">
                          {trimmed}
                        </p>
                      );
                    })}
                  </div>

                  {reflection.actions && reflection.actions.length > 0 && (
                    <div className="mt-12 pt-12 border-t border-[var(--line)] space-y-8">
                      <header className="text-center space-y-2">
                        <span className="text-[10px] uppercase tracking-[0.4em] font-bold text-[var(--text-muted)]">Compromisos de hoy</span>
                        <h3 className="text-xl font-display italic text-[var(--text-main)]">Micro-Acciones</h3>
                      </header>
                      <div className="grid gap-4">
                        {reflection.actions.map((action, idx) => (
                          <motion.button
                            key={idx}
                            whileHover={{ scale: 1.01 }}
                            whileTap={{ scale: 0.98 }}
                            onClick={() => handleActionToggle(action)}
                            className={`flex items-start gap-4 p-5 rounded-2xl border transition-all text-left ${completedActions[action] ? 'bg-[var(--text-main)] border-[var(--text-main)] text-[var(--bg-app)] opacity-60' : 'bg-[var(--surface)] border-[var(--line)] hover:border-[var(--text-muted)]'}`}
                          >
                            <div className={`mt-1 w-5 h-5 rounded-md border flex items-center justify-center transition-colors ${completedActions[action] ? 'bg-[var(--bg-app)] border-transparent text-[var(--text-main)]' : 'border-[var(--text-muted)]'}`}>
                              {completedActions[action] && <Check size={12} strokeWidth={4} />}
                            </div>
                            <span className={`text-sm font-medium leading-relaxed ${completedActions[action] ? 'line-through opacity-50' : ''}`}>
                              {action}
                            </span>
                          </motion.button>
                        ))}
                      </div>
                      {Object.values(completedActions).filter(Boolean).length === reflection.actions.length && (
                        <motion.div 
                          initial={{ opacity: 0, y: 10 }}
                          animate={{ opacity: 1, y: 0 }}
                          className="p-6 rounded-2xl bg-green-500/10 border border-green-500/20 text-center"
                        >
                          <p className="text-xs font-bold uppercase tracking-widest text-green-600">¡Tu luz brilla con fuerza hoy!</p>
                        </motion.div>
                      )}
                    </div>
                  )}

                  <footer className="pt-20 flex flex-col items-center gap-6">
                     <button 
                      onClick={() => setOffset(Math.floor(Math.random() * 10000))}
                      disabled={loading}
                      className="px-12 py-5 bg-[var(--text-main)] text-[var(--bg-app)] rounded-full text-xs font-bold uppercase tracking-[0.2em] hover:opacity-90 transition-all flex items-center gap-4 shadow-2xl active:scale-95 disabled:opacity-50"
                    >
                      {loading ? 'Preparando...' : 'Generar nueva reflexión'} <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
                    </button>

                    <button 
                      onClick={() => {
                        setShowChat(true);
                        if (chatMessages.length === 0) {
                          setChatMessages([{ role: 'model', content: `Hola. He estado meditando sobre "${reflection.title}". ¿Hay algo en lo que desees profundizar o alguna duda sobre cómo aplicar esto a tu vida hoy?` }]);
                        }
                      }}
                      className="px-8 py-4 border border-[var(--line)] text-[var(--text-main)] rounded-full text-[10px] font-bold uppercase tracking-[0.2em] hover:bg-[var(--line)] transition-all flex items-center gap-3 active:scale-95"
                    >
                      Preguntar al Mentor <MessageSquareQuote size={14} />
                    </button>
                  </footer>
                </article>
              </motion.main>
            ) : !loading && error ? (
              <motion.div 
                key="error"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="flex flex-col items-center justify-center min-h-[50vh] text-center glass-card rounded-2xl p-12"
              >
                <div className="w-20 h-20 rounded-full bg-red-50 flex items-center justify-center mb-8">
                  <X size={32} className="text-red-400" />
                </div>
                <h3 className="text-sm font-bold uppercase tracking-[0.3em] mb-4">Interrupción de flujo</h3>
                <p className="text-xs text-[var(--text-muted)] uppercase tracking-widest leading-loose max-w-sm mb-10">
                  {error}
                </p>
                <button 
                  onClick={() => generateReflection()}
                  className="px-8 py-4 bg-[var(--text-main)] text-[var(--bg-app)] rounded-full text-xs uppercase tracking-widest font-bold hover:scale-105 transition-all"
                >
                  Intentar de nuevo
                </button>
              </motion.div>
            ) : (
              <div className="flex flex-col items-center justify-center min-h-[60vh] gap-8">
                <div className="w-64 h-64 relative">
                  <div className="absolute inset-0 bg-[var(--text-main)]/5 rounded-full animate-pulse blur-3xl" />
                  <DotLottieReact
                    src="https://lottie.host/8fbc01e5-92e3-4410-8659-e0ea4e81ed5b/r8PzE4gxKw.lottie"
                    autoplay
                    loop
                  />
                </div>
                <div className="space-y-2 text-center">
                  <p className="text-[10px] uppercase tracking-[0.5em] font-bold text-[var(--text-muted)] animate-pulse">&nbsp;</p>
                </div>
              </div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* Share Overlay */}
      <AnimatePresence>
        {showShare && (
          <div className="fixed inset-0 z-[200] flex items-center justify-center p-6 sm:p-0">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowShare(false)}
              className="absolute inset-0 bg-black/60 backdrop-blur-md"
            />
            <motion.div 
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="relative w-full max-w-md glass-card rounded-2xl p-10 space-y-8"
            >
              <div className="flex justify-between items-center">
                <h3 className="text-xs uppercase tracking-widest font-bold opacity-50">Compartir Palabra</h3>
                <button onClick={() => setShowShare(false)} className="p-2 hover:bg-[var(--line)] rounded-full transition-all">
                  <X size={18} />
                </button>
              </div>
              
              <div className="grid grid-cols-2 gap-4">
                <button 
                  onClick={copyToClipboard}
                  className="flex flex-col items-center gap-4 p-8 glass-card rounded-2xl hover:bg-[var(--text-main)] hover:text-[var(--bg-app)] transition-all group"
                >
                  <Copy size={24} className="opacity-50 group-hover:opacity-100" />
                  <span className="text-[9px] uppercase tracking-widest font-bold">Copiar Texto</span>
                </button>
                <button className="flex flex-col items-center gap-4 p-8 glass-card rounded-2xl opacity-40 cursor-not-allowed">
                  <Download size={24} />
                  <span className="text-[9px] uppercase tracking-widest font-bold">Imagen (Pronto)</span>
                </button>
              </div>
              
              <p className="text-[9px] text-center uppercase tracking-widest opacity-30">"Gratis recibisteis, dad de gracia"</p>
            </motion.div>
          </div>
        )}
        {/* Mentor Chat Drawer */}
        <AnimatePresence>
          {showChat && (
            <>
              <motion.div 
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={() => setShowChat(false)}
                className="fixed inset-0 bg-[var(--text-main)]/20 backdrop-blur-sm z-[100]"
              />
              <motion.div 
                initial={{ x: '100%' }}
                animate={{ x: 0 }}
                exit={{ x: '100%' }}
                transition={{ type: 'spring', damping: 25, stiffness: 200 }}
                className="fixed top-0 right-0 h-full w-full max-w-lg bg-[var(--bg-app)] shadow-2xl z-[101] flex flex-col theme-transition"
              >
                <header className="p-6 border-b border-[var(--line)] flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-[var(--text-main)] flex items-center justify-center text-[var(--bg-app)]">
                      <Sparkles size={20} />
                    </div>
                    <div>
                      <h3 className="font-display text-lg italic text-[var(--text-main)] leading-none">Mentor de iLumina</h3>
                      <span className="text-[10px] uppercase tracking-widest text-[var(--text-muted)] font-bold">Acompañamiento espiritual</span>
                    </div>
                  </div>
                  <button onClick={() => setShowChat(false)} className="p-2 hover:bg-[var(--line)] rounded-full transition-all">
                    <X size={20} />
                  </button>
                </header>

                <div className="flex-1 overflow-y-auto p-6 space-y-6 scrollbar-hide">
                  {chatMessages.map((msg, i) => (
                    <motion.div 
                      key={i}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                    >
                      <div className={`max-w-[85%] p-4 rounded-2xl text-sm leading-relaxed ${
                        msg.role === 'user' 
                          ? 'bg-[var(--text-main)] text-[var(--bg-app)] rounded-tr-none shadow-lg' 
                          : 'bg-[var(--surface)] text-[var(--text-main)] border border-[var(--line)] rounded-tl-none'
                      }`}>
                        {msg.content}
                      </div>
                    </motion.div>
                  ))}
                  {chatLoading && (
                    <div className="flex justify-start">
                      <div className="bg-[var(--surface)] p-4 rounded-2xl border border-[var(--line)] rounded-tl-none flex gap-1">
                        <motion.div animate={{ opacity: [0.3, 1, 0.3] }} transition={{ repeat: Infinity, duration: 1 }} className="w-1.5 h-1.5 rounded-full bg-[var(--text-muted)]" />
                        <motion.div animate={{ opacity: [0.3, 1, 0.3] }} transition={{ repeat: Infinity, duration: 1, delay: 0.2 }} className="w-1.5 h-1.5 rounded-full bg-[var(--text-muted)]" />
                        <motion.div animate={{ opacity: [0.3, 1, 0.3] }} transition={{ repeat: Infinity, duration: 1, delay: 0.4 }} className="w-1.5 h-1.5 rounded-full bg-[var(--text-muted)]" />
                      </div>
                    </div>
                  )}
                  <div id="chat-bottom" />
                </div>

                <form 
                  onSubmit={(e) => {
                    e.preventDefault();
                    const input = e.currentTarget.elements.namedItem('message') as HTMLInputElement;
                    if (input.value.trim()) {
                      handleSendMessage(input.value);
                      input.value = '';
                    }
                  }}
                  className="p-6 border-t border-[var(--line)] bg-[var(--surface)]"
                >
                  <div className="relative">
                    <input 
                      name="message"
                      autoComplete="off"
                      placeholder="Escribe tu inquietud..."
                      className="w-full pl-4 pr-12 py-4 rounded-2xl bg-[var(--bg-app)] border border-[var(--line)] text-sm focus:outline-none focus:border-[var(--text-main)] transition-all placeholder:text-[var(--text-muted)]/50"
                    />
                    <button 
                      type="submit"
                      disabled={chatLoading}
                      className="absolute right-2 top-2 p-2 bg-[var(--text-main)] text-[var(--bg-app)] rounded-xl hover:opacity-90 transition-all disabled:opacity-50"
                    >
                      <Send size={18} />
                    </button>
                  </div>
                  <p className="mt-3 text-[10px] text-center text-[var(--text-muted)] font-medium uppercase tracking-widest">El Mentor te guía basado en la sabiduría eterna</p>
                </form>
              </motion.div>
            </>
          )}
        </AnimatePresence>

      </AnimatePresence>
    </div>
  );
}
