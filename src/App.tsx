import { useState, useEffect, useMemo } from 'react';
import { DateTime } from 'luxon';
import { Search, MapPin, Clock, ArrowRightLeft, Sun, Moon } from 'lucide-react';
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
  const [targetZone, setTargetZone] = useState('America/New_York');
  const [localTime, setLocalTime] = useState(DateTime.now().setZone(sourceZone));
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [isSynced, setIsSynced] = useState(false);
  const [syncStatus, setSyncStatus] = useState<'idle' | 'syncing' | 'success' | 'error'>('idle');

  const syncLocation = () => {
    if (!("geolocation" in navigator)) {
      setSyncStatus('error');
      setTimeout(() => setSyncStatus('idle'), 3000);
      return;
    }

    setSyncStatus('syncing');
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const { latitude, longitude } = position.coords;
        
        let closestCity = cityMapping[0];
        let minDistance = Infinity;
        
        cityMapping.forEach(city => {
          const lat = Number(city.lat);
          const lng = Number(city.lng);
          const distance = Math.sqrt(Math.pow(latitude - lat, 2) + Math.pow(longitude - lng, 2));
          if (distance < minDistance) {
            minDistance = distance;
            closestCity = city;
          }
        });
        
        if (closestCity && closestCity.timezone) {
          setSourceZone(closestCity.timezone);
          setLocalTime(DateTime.now().setZone(closestCity.timezone));
          setSyncStatus('success');
          setIsSynced(true);
          setTimeout(() => {
            setSyncStatus('idle');
            setIsSynced(false);
          }, 4000);
        }
      },
      (error) => {
        console.warn("Geolocation error:", error.message);
        setSyncStatus('error');
        setTimeout(() => setSyncStatus('idle'), 3000);
      }
    );
  };

  // Auto-sync on mount
  useEffect(() => {
    syncLocation();
  }, []);

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
    const timer = setInterval(() => {
      setLocalTime(DateTime.now().setZone(sourceZone));
    }, 1000);
    return () => clearInterval(timer);
  }, [sourceZone]);

  const toggleTheme = () => {
    setTheme(prev => prev === 'light' ? 'dark' : 'light');
  };

  // When switching to manual mode, localTime remains at its current value
  // and the picker will modify it directly.
  // When switching back to live mode, the interval will take over.

  const handleSwap = () => {
    const oldSourceZone = sourceZone;
    const oldTargetZone = targetZone;
    
    setSourceZone(oldTargetZone);
    setTargetZone(oldSourceZone);
    
    // Maintain the moment by shifting localTime to the new source zone
    setLocalTime(localTime.setZone(oldTargetZone));
    
    // Trigger rotation animation
    setSwapRotation(prev => prev + 180);
    
    // Trigger ping effect
    setShowPing(true);
    setTimeout(() => setShowPing(false), 600);
  };

  const [splitRatio, setSplitRatio] = useState(50);
  const [isDragging, setIsDragging] = useState(false);
  const [isHoveringTarget, setIsHoveringTarget] = useState(false);
  const [swapRotation, setSwapRotation] = useState(0);
  const [showPing, setShowPing] = useState(false);

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

  const targetTime = localTime.setZone(targetZone);

  // Calculate time difference with minute precision
  const totalDiffMinutes = targetTime.offset - localTime.offset;
  const absDiffMinutes = Math.abs(totalDiffMinutes);
  const hours = Math.floor(absDiffMinutes / 60);
  const minutes = absDiffMinutes % 60;

  let diffText = '';
  if (totalDiffMinutes === 0) {
    diffText = 'Same time';
  } else {
    const parts = [];
    if (hours > 0) {
      parts.push(`${hours} hour${hours > 1 ? 's' : ''}`);
    }
    if (minutes > 0) {
      parts.push(`${minutes} minute${minutes > 1 ? 's' : ''}`);
    }
    diffText = `${parts.join(' ')} ${totalDiffMinutes > 0 ? 'ahead' : 'behind'}`;
  }

  const targetOffset = targetTime.toFormat('ZZZZ');
  const showOffset = targetTime.offset !== localTime.offset;

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
                {syncStatus === 'syncing' ? 'Detecting your location...' :
                 syncStatus === 'success' ? `Synced to ${sourceZone.split('/').pop()?.replace(/_/g, ' ')}` :
                 'Location sync failed'}
              </span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="max-w-5xl mx-auto px-6 py-12 md:py-24 flex flex-col items-center">
        
        {/* Header */}
        <header className="mb-16 text-center relative w-full">
          <div className="absolute right-0 top-0">
            <button
              onClick={toggleTheme}
              className={`p-3 rounded-2xl border transition-all ${theme === 'light' ? 'bg-white border-stone-200 text-stone-400 hover:text-stone-600' : 'bg-stone-900 border-stone-800 text-stone-500 hover:text-stone-300'}`}
            >
              {theme === 'light' ? <Moon className="w-5 h-5" /> : <Sun className="w-5 h-5" />}
            </button>
          </div>
          <h1 className={`text-sm font-medium uppercase tracking-[0.2em] mb-2 ${theme === 'light' ? 'text-stone-400' : 'text-stone-600'}`}>TimeSync</h1>
          <p className={`text-2xl font-light italic ${theme === 'light' ? 'text-stone-600' : 'text-stone-400'}`}>Compare moments across the globe.</p>
        </header>

        {/* Search & Swap Section */}
        <div className="flex items-center gap-4 w-full max-w-2xl mb-16 relative z-50">
          <div className="relative flex-1 group">
            <Search className={`absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 transition-colors ${theme === 'light' ? 'text-stone-400 group-focus-within:text-stone-600' : 'text-stone-600 group-focus-within:text-stone-400'}`} />
            <input
              type="text"
              placeholder="Search for a city or timezone..."
              className={`w-full pl-12 pr-12 py-4 border rounded-3xl shadow-sm focus:outline-none focus:ring-2 transition-all ${theme === 'light' ? 'bg-white border-stone-200 focus:ring-stone-200 focus:border-stone-300 text-stone-700 placeholder:text-stone-300' : 'bg-stone-900 border-stone-800 focus:ring-stone-800 focus:border-stone-700 text-stone-200 placeholder:text-stone-700'}`}
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setIsSearching(true);
              }}
              onFocus={() => setIsSearching(true)}
            />
            
            <button
              onClick={syncLocation}
              title="Sync with your location"
              className={`absolute right-4 top-1/2 -translate-y-1/2 p-2 rounded-xl transition-all duration-300 ${theme === 'light' ? 'text-stone-400 hover:bg-stone-100 hover:text-stone-600' : 'text-stone-600 hover:bg-stone-800 hover:text-stone-400'}`}
            >
              <MapPin className={`w-4 h-4 ${syncStatus === 'syncing' ? 'animate-pulse text-emerald-500' : ''}`} />
            </button>

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
                          setTargetZone(result.timezone);
                          setSearchQuery('');
                          setIsSearching(false);
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

          <motion.button
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            animate={{ rotate: swapRotation }}
            transition={{ type: "spring", stiffness: 260, damping: 20 }}
            onClick={handleSwap}
            title="Swap timezones"
            className={`p-4 border rounded-2xl shadow-sm transition-all shrink-0 relative overflow-visible ${theme === 'light' ? 'bg-white border-stone-200 text-stone-400 hover:bg-stone-50 hover:border-stone-300 hover:text-stone-600' : 'bg-stone-900 border-stone-800 text-stone-600 hover:bg-stone-800 hover:border-stone-700 hover:text-stone-400'}`}
          >
            <ArrowRightLeft className="w-6 h-6" />
            <AnimatePresence>
              {showPing && (
                <motion.div
                  initial={{ scale: 0.8, opacity: 0.5 }}
                  animate={{ scale: 2, opacity: 0 }}
                  exit={{ opacity: 0 }}
                  className={`absolute inset-0 rounded-2xl pointer-events-none ${theme === 'light' ? 'bg-stone-400/20' : 'bg-stone-400/10'}`}
                />
              )}
            </AnimatePresence>
          </motion.button>
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
              {localTime.toFormat('hh:mm:ss a')}
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
            key={`target-${targetZone}`}
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            style={{ flex: `0 0 ${100 - splitRatio}%` }}
            className="bg-stone-900 p-8 rounded-[2rem] shadow-xl flex flex-col items-center text-center text-white relative overflow-hidden group transition-all duration-300 ease-out"
            onMouseEnter={() => setIsHoveringTarget(true)}
            onMouseLeave={() => setIsHoveringTarget(false)}
          >
            {/* Tooltip */}
            <div className={`absolute top-6 left-1/2 -translate-x-1/2 bg-white/10 backdrop-blur-xl border border-white/20 px-6 py-3 rounded-2xl text-[11px] font-medium text-white z-50 transition-all duration-500 shadow-2xl flex flex-col items-center gap-1 min-w-max ${isHoveringTarget ? 'opacity-100 translate-y-0 scale-100' : 'opacity-0 translate-y-4 scale-95 pointer-events-none'}`}>
              <span className="opacity-60 uppercase tracking-widest text-[9px]">Timezone Details</span>
              <span className="text-white font-semibold">{targetZone.replace(/_/g, ' ')}</span>
              <span className="text-stone-400">{targetTime.offsetNameLong} • {targetOffset}</span>
            </div>

            <div className="flex items-center gap-2 text-stone-500 mb-6 font-medium text-xs uppercase tracking-wider relative z-10 whitespace-nowrap">
              <Clock className="w-3 h-3" />
              Their Time
            </div>
            <div className="text-5xl lg:text-7xl font-light tracking-tighter text-white mb-4 tabular-nums relative z-10 whitespace-nowrap">
              {targetTime.toFormat('hh:mm:ss a')}
            </div>
            <div className="mt-8 pt-6 border-t border-stone-800 w-full text-stone-400 text-sm font-medium relative z-10 truncate">
              {targetZone}
            </div>
          </motion.div>

        </div>

        {/* Time Difference Indicator */}
        <div className={`mt-12 flex items-center gap-4 px-6 py-3 rounded-full shadow-sm border transition-all ${theme === 'light' ? 'bg-white border-stone-100' : 'bg-stone-900 border-stone-800'}`}>
          <ArrowRightLeft className={`w-4 h-4 ${theme === 'light' ? 'text-stone-400' : 'text-stone-600'}`} />
          <span className={`font-medium text-sm ${theme === 'light' ? 'text-stone-600' : 'text-stone-400'}`}>
            {diffText}
          </span>
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
