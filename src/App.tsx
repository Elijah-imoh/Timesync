import { useState, useEffect, useMemo, ChangeEvent, useCallback, useRef } from 'react';
import { DateTime } from 'luxon';
import { Search, MapPin, Clock, ArrowRightLeft, Sun, Moon, Share } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cityMapping } from 'city-timezones';

interface SearchResult {
  type: 'city' | 'timezone';
  name: string;
  timezone: string;
  country?: string;
  lat?: number;
  lng?: number;
}

export default function App() {
  const [sourceZone, setSourceZone] = useState(DateTime.now().zoneName || 'UTC');
  const [targetZone, setTargetZone] = useState<string | null>(null);
  const [localTime, setLocalTime] = useState(DateTime.now().setZone(sourceZone));
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  const [searchQuery, setSearchQuery] = useState('');
  const [activeSearchField, setActiveSearchField] = useState<'source' | 'target'>('target');
  const [isSearching, setIsSearching] = useState(false);
  const [isSynced, setIsSynced] = useState(false);
  const [syncStatus, setSyncStatus] = useState<'idle' | 'syncing' | 'success' | 'error'>('idle');
  const [syncMessage, setSyncMessage] = useState('');
  const [isLive, setIsLive] = useState(true);
  const [timeFormat, setTimeFormat] = useState<'12h' | '24h'>('12h');
  const [recentSearches, setRecentSearches] = useState<SearchResult[]>([]);

  // Load recent searches on mount
  useEffect(() => {
    const saved = localStorage.getItem('recentTimezones');
    if (saved) {
      try {
        setRecentSearches(JSON.parse(saved));
      } catch (e) {
        console.error("Failed to parse recent searches", e);
      }
    }
  }, []);

  const addToRecent = (result: SearchResult) => {
    setRecentSearches(prev => {
      const filtered = prev.filter(r => r.timezone !== result.timezone);
      const updated = [result, ...filtered].slice(0, 5);
      localStorage.setItem('recentTimezones', JSON.stringify(updated));
      return updated;
    });
  };

  const syncLocation = useCallback(() => {
    setSyncStatus('syncing');
    setSyncMessage('Detecting your location...');
    
    // Primary: Browser's resolved timezone (instant, no permissions)
    try {
      const browserTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      if (browserTz && browserTz !== 'undefined') {
        const testTime = DateTime.now().setZone(browserTz);
        if (testTime.isValid) {
          setSourceZone(browserTz);
          setLocalTime(testTime);
          setSyncStatus('success');
          setSyncMessage(`Synced to ${browserTz.split('/').pop()?.replace(/_/g, ' ')}`);
          setIsSynced(true);
          setTimeout(() => {
            setSyncStatus('idle');
            setIsSynced(false);
          }, 4000);
          return;
        }
      }
    } catch (e) {
      console.warn("Intl timezone detection failed:", e);
    }

    // Secondary: Geolocation (requires permission)
    if (!("geolocation" in navigator)) {
      setSyncStatus('error');
      setSyncMessage('Location sync failed');
      setTimeout(() => setSyncStatus('idle'), 3000);
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        const { latitude, longitude } = position.coords;
        
        let closestCity = null;
        let minDistance = Infinity;
        
        if (cityMapping && Array.isArray(cityMapping)) {
          cityMapping.forEach(city => {
            const lat = Number(city.lat);
            const lng = Number(city.lng);
            if (!isNaN(lat) && !isNaN(lng)) {
              const distance = Math.sqrt(Math.pow(latitude - lat, 2) + Math.pow(longitude - lng, 2));
              if (distance < minDistance) {
                minDistance = distance;
                closestCity = city;
              }
            }
          });
        }
        
        if (closestCity && closestCity.timezone) {
          const testTime = DateTime.now().setZone(closestCity.timezone);
          if (testTime.isValid) {
            setSourceZone(closestCity.timezone);
            setLocalTime(testTime);
            setSyncStatus('success');
            setSyncMessage(`Synced to ${closestCity.timezone.split('/').pop()?.replace(/_/g, ' ')}`);
            setIsSynced(true);
            setTimeout(() => {
              setSyncStatus('idle');
              setIsSynced(false);
            }, 4000);
            return;
          }
        }
        
        setSyncStatus('error');
        setSyncMessage('Location sync failed');
        setTimeout(() => setSyncStatus('idle'), 3000);
      },
      (error) => {
        console.warn("Geolocation error:", error.message);
        setSyncStatus('error');
        setSyncMessage('Location sync failed');
        setTimeout(() => setSyncStatus('idle'), 3000);
      },
      { timeout: 10000, enableHighAccuracy: false }
    );
  }, [cityMapping]);

  // Auto-sync or load from URL on mount
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const src = params.get('src');
    const tgt = params.get('tgt');
    
    if (src || tgt) {
      if (src) {
        setSourceZone(src);
        setLocalTime(DateTime.now().setZone(src));
      }
      if (tgt) setTargetZone(tgt);
      
      // Clear URL params to keep it clean after loading
      window.history.replaceState({}, '', window.location.pathname);
    } else {
      syncLocation();
    }
  }, [syncLocation]);

  const allTimezones = useMemo(() => {
    try {
      return Intl.supportedValuesOf('timeZone');
    } catch (e) {
      return ['UTC', 'America/New_York', 'Europe/London', 'Asia/Tokyo', 'Australia/Sydney'];
    }
  }, []);

  const searchResults = useMemo(() => {
    if (!searchQuery || searchQuery.length < 2) return [];
    const query = searchQuery.toLowerCase();
    const results: SearchResult[] = [];

    // 1. Timezone matches
    const tzMatches = allTimezones.filter(tz => 
      tz.toLowerCase().includes(query)
    ).sort((a, b) => {
      const aLower = a.toLowerCase();
      const bLower = b.toLowerCase();
      if (aLower === query) return -1;
      if (bLower === query) return 1;
      if (aLower.startsWith(query) && !bLower.startsWith(query)) return -1;
      if (!aLower.startsWith(query) && bLower.startsWith(query)) return 1;
      return a.localeCompare(b);
    }).slice(0, 5);

    tzMatches.forEach(tz => {
      results.push({
        type: 'timezone',
        name: tz.replace(/_/g, ' '),
        timezone: tz
      });
    });

    // 2. City and Country matches from cityMapping
    // We'll search in city, country, and province
    const cityMatches = cityMapping.filter(city => {
      const cityName = city.city.toLowerCase();
      const countryName = city.country.toLowerCase();
      const provinceName = (city as any).province?.toLowerCase() || '';
      
      return cityName.includes(query) || 
             countryName.includes(query) || 
             provinceName.includes(query);
    }).sort((a, b) => {
      const aCity = a.city.toLowerCase();
      const bCity = b.city.toLowerCase();
      const aCountry = a.country.toLowerCase();
      const bCountry = b.country.toLowerCase();

      // Prioritize exact city match
      if (aCity === query && bCity !== query) return -1;
      if (bCity === query && aCity !== query) return 1;

      // Prioritize city starts with
      if (aCity.startsWith(query) && !bCity.startsWith(query)) return -1;
      if (!aCity.startsWith(query) && bCity.startsWith(query)) return 1;

      // Prioritize exact country match
      if (aCountry === query && bCountry !== query) return -1;
      if (bCountry === query && aCountry !== query) return 1;

      return a.city.localeCompare(b.city);
    }).slice(0, 15); // Show more results for better coverage

    cityMatches.forEach(city => {
      // Avoid duplicate timezones if they are already in results as timezone type
      // but only if the name matches exactly to avoid confusion
      const displayName = `${city.city}${city.country ? `, ${city.country}` : ''}`;
      
      if (!results.some(r => r.name === displayName)) {
        results.push({
          type: 'city',
          name: displayName,
          timezone: city.timezone,
          country: city.country,
          lat: Number(city.lat),
          lng: Number(city.lng)
        });
      }
    });

    return results;
  }, [searchQuery, allTimezones]);

  // Update time every second
  useEffect(() => {
    if (!isLive) return;
    const timer = setInterval(() => {
      setLocalTime(DateTime.now().setZone(sourceZone));
    }, 1000);
    return () => clearInterval(timer);
  }, [sourceZone, isLive]);

  const toggleTheme = () => {
    setTheme(prev => prev === 'light' ? 'dark' : 'light');
  };

  const handleTimeSelect = (hour: number, minute: number, zone: 'source' | 'target') => {
    setIsLive(false);
    if (zone === 'source') {
      const newTime = localTime.set({ hour, minute, second: 0 });
      setLocalTime(newTime);
    } else if (zone === 'target' && targetZone) {
      const currentTargetTime = localTime.setZone(targetZone);
      const newTargetTime = currentTargetTime.set({ hour, minute, second: 0 });
      setLocalTime(newTargetTime.setZone(sourceZone));
    }
  };

  const handleAmPmChange = (zone: 'source' | 'target', newAmPm: string) => {
    setIsLive(false);
    const isPm = newAmPm === 'PM';
    
    if (zone === 'source') {
      let hour = localTime.hour % 12;
      if (isPm) hour += 12;
      setLocalTime(localTime.set({ hour }));
    } else if (targetZone) {
      const currentTargetTime = localTime.setZone(targetZone);
      let hour = currentTargetTime.hour % 12;
      if (isPm) hour += 12;
      const newTargetTime = currentTargetTime.set({ hour });
      setLocalTime(newTargetTime.setZone(sourceZone));
    }
  };

  const returnToLive = () => {
    setIsLive(true);
    setLocalTime(DateTime.now().setZone(sourceZone));
  };

  const handleShare = () => {
    const url = new URL(window.location.origin + window.location.pathname);
    url.searchParams.set('src', sourceZone);
    if (targetZone) {
      url.searchParams.set('tgt', targetZone);
    }
    
    navigator.clipboard.writeText(url.toString()).then(() => {
      setSyncStatus('success');
      setSyncMessage('Share link copied to clipboard!');
      setTimeout(() => setSyncStatus('idle'), 3000);
    }).catch(err => {
      console.error('Failed to copy: ', err);
      setSyncStatus('error');
      setSyncMessage('Failed to copy link');
      setTimeout(() => setSyncStatus('idle'), 3000);
    });
  };

  const [splitRatio, setSplitRatio] = useState(50);
  const [isDragging, setIsDragging] = useState(false);
  const [isHoveringTarget, setIsHoveringTarget] = useState(false);

  // Handle dragging for resizing
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging) return;
      const container = document.getElementById('comparison-container');
      if (!container) return;
      const rect = container.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const newRatio = Math.max(25, Math.min(75, (x / rect.width) * 100));
      setSplitRatio(newRatio);
    };

    const handleMouseUp = () => {
      setIsDragging(false);
      document.body.style.cursor = 'default';
    };

    if (isDragging) {
      document.body.style.cursor = 'col-resize';
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
    }

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging]);

  const targetTime = targetZone ? localTime.setZone(targetZone) : null;

  const handleSwap = () => {
    if (!targetZone) return;
    const oldSource = sourceZone;
    const oldTarget = targetZone;
    const currentTargetTime = targetTime;
    
    setSourceZone(oldTarget);
    setTargetZone(oldSource);
    if (currentTargetTime) {
      setLocalTime(currentTargetTime);
    }
  };

  const conversionSummary = useMemo(() => {
    if (!targetZone || !targetTime) return null;
    const fromTime = localTime.toFormat(timeFormat === '12h' ? 'hh:mm a' : 'HH:mm');
    const toTime = targetTime.toFormat(timeFormat === '12h' ? 'hh:mm a' : 'HH:mm');
    const fromName = sourceZone.split('/').pop()?.replace(/_/g, ' ');
    const toName = targetZone.split('/').pop()?.replace(/_/g, ' ');
    return `${fromTime} (${fromName}) = ${toTime} (${toName})`;
  }, [localTime, targetTime, sourceZone, targetZone, timeFormat]);

  // Calculate time difference with minute precision
  const diffText = useMemo(() => {
    if (!targetTime) return null;
    const totalDiffMinutes = targetTime.offset - localTime.offset;
    const absDiffMinutes = Math.abs(totalDiffMinutes);
    const hours = Math.floor(absDiffMinutes / 60);
    const minutes = absDiffMinutes % 60;

    if (totalDiffMinutes === 0) {
      return 'Same time';
    } else {
      const parts = [];
      if (hours > 0) {
        parts.push(`${hours} hour${hours > 1 ? 's' : ''}`);
      }
      if (minutes > 0) {
        parts.push(`${minutes} minute${minutes > 1 ? 's' : ''}`);
      }
      return `${parts.join(' ')} ${totalDiffMinutes > 0 ? 'ahead' : 'behind'}`;
    }
  }, [targetTime, localTime.offset]);

  const targetOffset = targetTime?.toFormat('ZZZZ');
  const showOffset = targetTime ? targetTime.offset !== localTime.offset : false;

  return (
    <div className={`min-h-screen transition-colors duration-500 ${theme === 'light' ? 'bg-stone-50 text-stone-900' : 'bg-stone-950 text-stone-50'} font-sans selection:bg-stone-200`}>
      {/* Sync Status Toast */}
      <AnimatePresence>
        {syncStatus !== 'idle' && (
          <motion.div
            initial={{ opacity: 0, y: -50, x: '-50%' }}
            animate={{ opacity: 1, y: 0, x: '-50%' }}
            exit={{ opacity: 0, y: -50, x: '-50%' }}
            className="fixed top-8 left-1/2 z-[100] pointer-events-none"
          >
            <div className={`px-6 py-3 rounded-full shadow-2xl border flex items-center gap-3 backdrop-blur-md ${
              syncStatus === 'syncing' ? 'bg-white/90 border-stone-200 text-stone-600' :
              syncStatus === 'success' ? 'bg-emerald-500/90 border-emerald-400 text-white' :
              'bg-rose-500/90 border-rose-400 text-white'
            }`}>
              {syncStatus === 'syncing' && (
                <motion.div 
                  animate={{ rotate: 360 }} 
                  transition={{ repeat: Infinity, duration: 1.5, ease: "linear" }}
                >
                  <Clock className="w-4 h-4" />
                </motion.div>
              )}
              {syncStatus === 'success' && <MapPin className="w-4 h-4" />}
              {syncStatus === 'error' && <Search className="w-4 h-4" />}
              <span className="text-sm font-medium tracking-tight">
                {syncMessage}
              </span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="max-w-5xl mx-auto px-6 py-12 md:py-24 flex flex-col items-center">
        
        {/* Header */}
        <header className="mb-16 text-center relative w-full">
          <div className="absolute right-0 top-0 flex items-center gap-3">
            <button
              onClick={() => setTimeFormat(prev => prev === '12h' ? '24h' : '12h')}
              className={`px-4 py-2.5 rounded-2xl border text-[10px] font-bold uppercase tracking-widest transition-all ${theme === 'light' ? 'bg-[#1c1917] border-stone-800 text-white hover:bg-stone-800' : 'bg-[#1c1917] border-stone-800 text-stone-500 hover:text-stone-300'}`}
            >
              {timeFormat}
            </button>
            <button
              onClick={handleShare}
              className={`p-3 rounded-2xl border transition-all ${theme === 'light' ? 'bg-[#1c1917] border-stone-800 text-white hover:bg-stone-800' : 'bg-[#1c1917] border-stone-800 text-stone-500 hover:text-stone-300'}`}
              title="Share comparison"
            >
              <Share className="w-5 h-5" />
            </button>
            <button
              onClick={toggleTheme}
              className={`p-3 rounded-2xl border transition-all ${theme === 'light' ? 'bg-[#1c1917] border-stone-800 text-white hover:bg-stone-800' : 'bg-[#1c1917] border-stone-800 text-stone-500 hover:text-stone-300'}`}
            >
              {theme === 'light' ? <Moon className="w-5 h-5" /> : <Sun className="w-5 h-5" />}
            </button>
          </div>
          <h1 className={`text-sm font-medium tracking-[0.2em] mb-2 ${theme === 'light' ? 'text-stone-400' : 'text-stone-600'}`}>Timesync</h1>
          <p className={`text-2xl font-light italic ${theme === 'light' ? 'text-stone-600' : 'text-stone-400'}`}>Compare moments across the globe.</p>
        </header>

        {/* Search & Swap Section */}
        <div className="w-full max-w-2xl mb-16 space-y-6">
          <div className="flex flex-col md:flex-row items-center gap-4 relative z-50">
            {/* Source Search */}
            <div className="relative flex-1 group w-full">
              <div className={`absolute left-4 top-1/2 -translate-y-1/2 flex items-center gap-2 pointer-events-none ${theme === 'light' ? 'text-stone-400 group-focus-within:text-stone-600' : 'text-stone-600 group-focus-within:text-stone-400'}`}>
                <Search className="w-4 h-4" />
                <span className="text-[10px] font-bold uppercase tracking-widest">From</span>
              </div>
              <input
                type="text"
                placeholder="Source city..."
                className={`w-full pl-20 pr-12 py-4 border rounded-3xl shadow-sm focus:outline-none focus:ring-2 transition-all ${theme === 'light' ? 'bg-white border-stone-200 focus:ring-stone-200 focus:border-stone-300 text-stone-700 placeholder:text-stone-300' : 'bg-stone-900 border-stone-800 focus:ring-stone-800 focus:border-stone-700 text-stone-200 placeholder:text-stone-700'}`}
                value={activeSearchField === 'source' ? searchQuery : sourceZone.split('/').pop()?.replace(/_/g, ' ') || ''}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  setIsSearching(true);
                  setActiveSearchField('source');
                }}
                onFocus={() => {
                  setIsSearching(true);
                  setActiveSearchField('source');
                  setSearchQuery('');
                }}
              />
              <button
                onClick={syncLocation}
                title="Sync with your location"
                className={`absolute right-4 top-1/2 -translate-y-1/2 p-2 rounded-xl transition-all duration-300 ${theme === 'light' ? 'text-stone-400 hover:bg-stone-100 hover:text-stone-600' : 'text-stone-600 hover:bg-stone-800 hover:text-stone-400'}`}
              >
                <MapPin className={`w-4 h-4 ${syncStatus === 'syncing' ? 'animate-pulse text-emerald-500' : ''}`} />
              </button>
            </div>

            {/* Swap Button */}
            <button
              onClick={handleSwap}
              disabled={!targetZone}
              className={`p-4 rounded-full border shadow-sm transition-all hover:scale-110 active:scale-95 disabled:opacity-30 disabled:hover:scale-100 ${theme === 'light' ? 'bg-white border-stone-200 text-stone-400 hover:text-stone-600' : 'bg-stone-900 border-stone-800 text-stone-600 hover:text-stone-400'}`}
            >
              <ArrowRightLeft className="w-5 h-5" />
            </button>

            {/* Target Search */}
            <div className="relative flex-1 group w-full">
              <div className={`absolute left-4 top-1/2 -translate-y-1/2 flex items-center gap-2 pointer-events-none ${theme === 'light' ? 'text-stone-400 group-focus-within:text-stone-600' : 'text-stone-600 group-focus-within:text-stone-400'}`}>
                <Search className="w-4 h-4" />
                <span className="text-[10px] font-bold uppercase tracking-widest">To</span>
              </div>
              <input
                type="text"
                placeholder="Target city..."
                className={`w-full pl-16 pr-4 py-4 border rounded-3xl shadow-sm focus:outline-none focus:ring-2 transition-all ${theme === 'light' ? 'bg-white border-stone-200 focus:ring-stone-200 focus:border-stone-300 text-stone-700 placeholder:text-stone-300' : 'bg-stone-900 border-stone-800 focus:ring-stone-800 focus:border-stone-700 text-stone-200 placeholder:text-stone-700'}`}
                value={activeSearchField === 'target' ? searchQuery : targetZone?.split('/').pop()?.replace(/_/g, ' ') || ''}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  setIsSearching(true);
                  setActiveSearchField('target');
                }}
                onFocus={() => {
                  setIsSearching(true);
                  setActiveSearchField('target');
                  setSearchQuery('');
                }}
              />

              <AnimatePresence>
                {isSearching && searchQuery.length >= 2 && (
                  <motion.div 
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 10 }}
                    className={`absolute top-full left-0 right-0 mt-3 border rounded-3xl shadow-2xl overflow-hidden z-50 ${theme === 'light' ? 'bg-white border-stone-200' : 'bg-stone-900 border-stone-800'}`}
                  >
                    {searchResults.length > 0 ? (
                      searchResults.map((result, idx) => (
                        <button
                          key={`${result.timezone}-${idx}`}
                          className={`w-full px-6 py-4 text-left transition-colors border-b last:border-0 flex items-center justify-between ${theme === 'light' ? 'hover:bg-stone-50 border-stone-100' : 'hover:bg-stone-800 border-stone-800'}`}
                          onClick={() => {
                            if (activeSearchField === 'source') {
                              setSourceZone(result.timezone);
                              setLocalTime(DateTime.now().setZone(result.timezone));
                            } else {
                              setTargetZone(result.timezone);
                            }
                            setSearchQuery('');
                            setIsSearching(false);
                            addToRecent(result);
                          }}
                        >
                          <div className="flex flex-col">
                            <span className={`text-sm font-medium ${theme === 'light' ? 'text-stone-700' : 'text-stone-200'}`}>{result.name}</span>
                            {result.type === 'city' && (
                              <span className={`text-[10px] uppercase tracking-wider ${theme === 'light' ? 'text-stone-400' : 'text-stone-600'}`}>{result.country} • {result.timezone}</span>
                            )}
                          </div>
                          <div className={`text-[10px] font-medium uppercase tracking-widest ${theme === 'light' ? 'text-stone-300' : 'text-stone-700'}`}>
                            {result.type}
                          </div>
                        </button>
                      ))
                    ) : (
                      <div className={`p-6 text-center text-sm ${theme === 'light' ? 'text-stone-400' : 'text-stone-600'}`}>
                        No results found
                      </div>
                    )}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>

          {/* Conversion Summary Display */}
          <AnimatePresence>
            {conversionSummary && (
              <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="flex justify-center"
              >
                <div className={`px-8 py-4 rounded-2xl border shadow-lg flex items-center gap-4 ${theme === 'light' ? 'bg-white border-stone-100' : 'bg-stone-900 border-stone-800'}`}>
                  <Clock className="w-5 h-5 text-emerald-500" />
                  <span className={`text-lg font-light tracking-tight ${theme === 'light' ? 'text-stone-800' : 'text-stone-100'}`}>
                    {conversionSummary}
                  </span>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Recent Searches */}

          <AnimatePresence>
            {recentSearches.length > 0 && !isSearching && (
              <motion.div 
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                className="flex flex-wrap justify-center gap-2 mt-4"
              >
                <span className={`text-[10px] font-bold tracking-widest self-center mr-2 ${theme === 'light' ? 'text-stone-300' : 'text-stone-700'}`}>Recent:</span>
                <button
                  onClick={() => {
                    setRecentSearches([]);
                    localStorage.removeItem('recentTimezones');
                  }}
                  className={`px-2 py-1 rounded-md text-[8px] font-bold uppercase tracking-wider transition-all ${theme === 'light' ? 'bg-[#1c1917] text-white hover:bg-stone-800' : 'bg-[#1c1917] text-stone-100 hover:bg-stone-800'}`}
                >
                  Clear
                </button>
                {recentSearches.map((recent) => (
                  <button
                    key={recent.timezone}
                    onClick={() => setTargetZone(recent.timezone)}
                    className={`px-3 py-1.5 rounded-full text-[10px] font-medium transition-all border ${
                      targetZone === recent.timezone 
                        ? 'bg-emerald-500 border-emerald-400 text-white shadow-sm' 
                        : theme === 'light' 
                          ? 'bg-white border-stone-100 text-stone-500 hover:border-stone-200 hover:text-stone-700' 
                          : 'bg-stone-900 border-stone-800 text-stone-400 hover:border-stone-700 hover:text-stone-200'
                    }`}
                  >
                    {recent.name.split(',')[0]}
                  </button>
                ))}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Comparison Cards Container */}
        <div 
          id="comparison-container"
          className="flex flex-col md:flex-row gap-8 md:gap-0 w-full items-stretch relative select-none"
        >
          
          {/* Local Card */}
          <motion.div 
            key={`source-${sourceZone}`}
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            style={{ flex: `0 0 ${splitRatio}%` }}
            className={`p-8 rounded-[2rem] shadow-sm border flex flex-col items-center text-center group hover:shadow-md transition-all duration-300 ease-out overflow-hidden ${theme === 'light' ? 'bg-white border-stone-100' : 'bg-stone-900 border-stone-800'}`}
          >
            <div className={`flex items-center gap-2 mb-6 font-medium text-xs uppercase tracking-wider whitespace-nowrap ${theme === 'light' ? 'text-stone-400' : 'text-stone-600'}`}>
              <MapPin className="w-3 h-3" />
              {sourceZone === DateTime.now().zoneName ? 'Your Local Time' : 'Your Time'}
              {isSynced && (
                <motion.span 
                  initial={{ opacity: 0, x: -5 }}
                  animate={{ opacity: 1, x: 0 }}
                  className="ml-2 text-[10px] bg-emerald-500/10 text-emerald-500 px-1.5 py-0.5 rounded-full"
                >
                  Synced
                </motion.span>
              )}
            </div>
            <div className={`text-5xl lg:text-7xl font-light tracking-tighter mb-4 tabular-nums whitespace-nowrap ${theme === 'light' ? 'text-stone-800' : 'text-stone-100'}`}>
              {localTime.toFormat(timeFormat === '12h' ? 'hh:mm:ss a' : 'HH:mm:ss')}
            </div>
            <div className={`mt-8 pt-6 border-t w-full text-sm font-medium truncate ${theme === 'light' ? 'border-stone-50 text-stone-500' : 'border-stone-800 text-stone-400'}`}>
              {sourceZone.replace(/_/g, ' ')}
            </div>
          </motion.div>

          {/* Resize Handle (Desktop Only) */}
          <div 
            className="hidden md:flex absolute top-0 bottom-0 z-20 cursor-col-resize items-center justify-center w-8 -mx-4 group"
            style={{ left: `${splitRatio}%` }}
            onMouseDown={() => setIsDragging(true)}
          >
            <div className={`w-1 h-12 rounded-full transition-all duration-200 ${isDragging ? 'bg-stone-400 h-24' : 'bg-stone-200 group-hover:bg-stone-300 group-hover:h-16'}`} />
          </div>

          {/* Target Card */}
          <motion.div 
            key={`target-${targetZone || 'none'}`}
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            style={{ flex: `0 0 ${100 - splitRatio}%` }}
            className={`p-8 rounded-[2rem] shadow-xl flex flex-col items-center justify-center text-center relative overflow-hidden group transition-all duration-500 ease-out ${targetZone ? 'bg-stone-900 text-white' : 'bg-stone-100/50 border-2 border-dashed border-stone-200 text-stone-400'}`}
            onMouseEnter={() => setIsHoveringTarget(true)}
            onMouseLeave={() => setIsHoveringTarget(false)}
          >
            {targetZone && targetTime ? (
              <>
                {/* Tooltip */}
                <div className={`absolute top-6 left-1/2 -translate-x-1/2 bg-white/10 backdrop-blur-xl border border-white/20 px-6 py-3 rounded-2xl text-[11px] font-medium text-white z-50 transition-all duration-500 shadow-2xl flex flex-col items-center gap-1 min-w-max ${isHoveringTarget ? 'opacity-100 translate-y-0 scale-100' : 'opacity-0 translate-y-4 scale-95 pointer-events-none'}`}>
                  <span className="opacity-60 uppercase tracking-widest text-[9px]">Timezone Details</span>
                  <span className="text-white font-semibold">{targetZone.replace(/_/g, ' ')}</span>
                  <span className="text-stone-400">{targetTime.offsetNameLong} • {targetOffset}</span>
                </div>

                <div className="flex items-center gap-2 text-stone-500 mb-6 font-medium text-xs uppercase tracking-wider relative z-10 whitespace-nowrap">
                  Their Time
                </div>
                <div 
                  className="text-5xl lg:text-7xl font-light tracking-tighter text-white mb-4 tabular-nums relative z-10 whitespace-nowrap"
                >
                  {targetTime.toFormat(timeFormat === '12h' ? 'hh:mm:ss a' : 'HH:mm:ss')}
                </div>
                <div className="mt-8 pt-6 border-t border-stone-800 w-full text-stone-400 text-sm font-medium relative z-10 truncate">
                  {targetZone.replace(/_/g, ' ')}
                </div>
              </>
            ) : (
              <div className="flex flex-col items-center gap-4 py-12">
                <div className="w-16 h-16 rounded-full bg-stone-200/50 flex items-center justify-center mb-2">
                  <Clock className="w-8 h-8 text-stone-300" />
                </div>
                <p className="text-xl font-light italic text-stone-400">Select time to compare</p>
              </div>
            )}
          </motion.div>

        </div>

        {/* Time Difference Indicator & Manual Controls */}
        <div className="mt-12 flex flex-col items-center gap-8 w-full max-w-4xl">
          <div className={`flex items-center gap-4 px-6 py-3 rounded-full shadow-sm border transition-all ${theme === 'light' ? 'bg-white border-stone-100' : 'bg-stone-900 border-stone-800'}`}>
            <ArrowRightLeft className={`w-4 h-4 ${theme === 'light' ? 'text-stone-400' : 'text-stone-600'}`} />
            <span className={`font-medium text-sm ${theme === 'light' ? 'text-stone-600' : 'text-stone-400'}`}>
              {diffText}
            </span>
          </div>

          {/* Manual Time Control Card - Standalone */}
          <div className="w-fit">
            <div className={`p-5 rounded-3xl shadow-xl border transition-all ${theme === 'light' ? 'bg-white border-stone-100' : 'bg-stone-900 border-stone-800'}`}>
              <div className="flex flex-col items-center">
                <div className="w-fit space-y-4">
                  <div className="flex items-center justify-between gap-6">
                    <div className="flex items-center gap-3">
                      <span className={`text-[9px] font-bold uppercase tracking-[0.2em] ${theme === 'light' ? 'text-stone-400' : 'text-stone-600'}`}>Manual Adjustment</span>
                      {!isLive && (
                        <span className="px-2 py-0.5 bg-amber-500/10 text-amber-500 text-[9px] font-bold uppercase rounded-md">Manual Mode</span>
                      )}
                      {isLive && (
                        <span className="px-2 py-0.5 bg-emerald-500/10 text-emerald-500 text-[9px] font-bold uppercase rounded-md">Live Sync</span>
                      )}
                    </div>
                    {!isLive && (
                      <button 
                        onClick={returnToLive}
                        className="flex items-center gap-2 px-4 py-2 bg-emerald-500/10 text-emerald-500 rounded-xl hover:bg-emerald-500/20 transition-all text-[10px] font-bold uppercase tracking-widest"
                      >
                        <Clock className="w-3 h-3" />
                        Return to Live
                      </button>
                    )}
                  </div>

                  <div className="grid grid-cols-2 gap-4 max-w-md">
                    {/* Hour Input */}
                    <div className="space-y-2">
                      <div className="flex justify-between items-center">
                        <div className="flex items-center gap-2">
                          <label className={`text-[10px] font-bold uppercase tracking-wider ${theme === 'light' ? 'text-stone-500' : 'text-stone-400'}`}>Hour</label>
                          <span className={`text-[9px] ${theme === 'light' ? 'text-stone-300' : 'text-stone-700'}`}>({timeFormat === '12h' ? '1-12' : '0-23'})</span>
                        </div>
                        {timeFormat === '12h' && (
                          <div className="flex bg-stone-100 dark:bg-stone-800 rounded-lg p-0.5">
                            {['AM', 'PM'].map((period) => (
                              <button
                                key={period}
                                onClick={() => handleAmPmChange('source', period)}
                                className={`px-1.5 py-0.5 rounded-md text-[8px] font-bold transition-all ${
                                  (period === 'AM' && localTime.hour < 12) || (period === 'PM' && localTime.hour >= 12)
                                    ? 'bg-[#4f4f4f] text-white shadow-sm'
                                    : 'text-stone-400 hover:text-stone-600 dark:hover:text-stone-200'
                                }`}
                              >
                                {period}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                      <div className="relative">
                        <input 
                          type="number" 
                          min={timeFormat === '12h' ? 1 : 0}
                          max={timeFormat === '12h' ? 12 : 23}
                          value={timeFormat === '12h' ? (localTime.hour % 12 || 12) : localTime.hour}
                          onChange={(e) => {
                            let val = parseInt(e.target.value);
                            if (isNaN(val)) return;
                            
                            if (timeFormat === '12h') {
                              if (val < 1) val = 1;
                              if (val > 12) val = 12;
                              const isPm = localTime.hour >= 12;
                              let newHour = val % 12;
                              if (isPm) newHour += 12;
                              handleTimeSelect(newHour, localTime.minute, 'source');
                            } else {
                              if (val < 0) val = 0;
                              if (val > 23) val = 23;
                              handleTimeSelect(val, localTime.minute, 'source');
                            }
                          }}
                          className={`w-full px-3 py-2 rounded-xl border font-mono text-sm transition-all focus:ring-2 focus:ring-emerald-500/20 outline-none ${
                            theme === 'light' 
                              ? 'bg-stone-50 border-stone-100 text-stone-800' 
                              : 'bg-stone-800/50 border-stone-700 text-stone-100'
                          }`}
                        />
                      </div>
                    </div>

                    {/* Minute Input */}
                    <div className="space-y-2">
                      <div className="flex justify-between items-center">
                        <div className="flex items-center gap-2">
                          <label className={`text-[10px] font-bold uppercase tracking-wider ${theme === 'light' ? 'text-stone-500' : 'text-stone-400'}`}>Minute</label>
                          <span className={`text-[9px] ${theme === 'light' ? 'text-stone-300' : 'text-stone-700'}`}>(0-59)</span>
                        </div>
                      </div>
                      <div className="relative">
                        <input 
                          type="number" 
                          min="0" 
                          max="59" 
                          value={localTime.minute}
                          onChange={(e) => {
                            let val = parseInt(e.target.value);
                            if (isNaN(val)) return;
                            if (val < 0) val = 0;
                            if (val > 59) val = 59;
                            handleTimeSelect(localTime.hour, val, 'source');
                          }}
                          className={`w-full px-3 py-2 rounded-xl border font-mono text-sm transition-all focus:ring-2 focus:ring-emerald-500/20 outline-none ${
                            theme === 'light' 
                              ? 'bg-stone-50 border-stone-100 text-stone-800' 
                              : 'bg-stone-800/50 border-stone-700 text-stone-100'
                          }`}
                        />
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <AnimatePresence>
            {isLive && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 10 }}
                className={`text-[10px] font-bold uppercase tracking-widest ${theme === 'light' ? 'text-stone-300' : 'text-stone-700'}`}
              >
                Live Sync Active
              </motion.div>
            )}
          </AnimatePresence>
        </div>

      </div>

      {/* Close search when clicking outside */}
      {isSearching && (
        <div 
          className="fixed inset-0 z-40" 
          onClick={() => setIsSearching(false)}
        />
      )}
    </div>
  );
}
