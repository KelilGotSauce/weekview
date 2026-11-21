import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  CalendarDays, ChevronLeft, ChevronRight, RefreshCw, LogOut,
  CheckCircle2, Circle, X, LockKeyhole, AlertCircle, Cloud,
  Database, ArrowUpRight, UserRound, Tv, Sunrise, Cigarette,
  Sandwich, ShowerHead, Dumbbell, MessagesSquare
} from 'lucide-react';
import './style.css';

const DAY_MS = 86400000;
const HABITS = [
  { label: 'No J.O.', aliases: ['no j.o', 'no jo', 'jo', 'no junk food'], icon: UserRound },
  { label: 'No E.N.T.', aliases: ['no e.n.t', 'no ent', 'ent'], icon: Tv },
  { label: '5 a.m.', aliases: ['5 a.m', '5am', '5 am', 'wake up at 5'], icon: Sunrise },
  { label: 'No S.W.', aliases: ['no s.w', 'no sw', 'no smoking weed', 'no weed', 'smoking weed', 'weed'], icon: Cigarette },
  { label: 'No F.D.D.', aliases: ['no f.d.d', 'no fdd', 'no f.d', 'no fd', 'f.d.d', 'fdd'], icon: Sandwich },
  { label: 'Cold showers', aliases: ['cold showers', 'cold shower'], icon: ShowerHead },
  { label: 'Workout', aliases: ['workout', 'work out', 'exercise'], icon: Dumbbell },
  { label: 'Hard conversations', aliases: ['hard conversations', 'hard conversation', 'hard convo', 'hard convos'], icon: MessagesSquare },
];
const normalize = value => String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const pad = n => String(n).padStart(2, '0');
const dateKey = d => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
const startOfWeek = value => {
  const d = new Date(value); d.setHours(0,0,0,0);
  d.setDate(d.getDate() - ((d.getDay()+6)%7)); return d;
};
const formatRange = start => {
  const end = new Date(start.getTime()+6*DAY_MS);
  const left = start.toLocaleDateString('en-US',{month:'short',day:'numeric'});
  const right = end.toLocaleDateString('en-US',{...(start.getMonth()===end.getMonth()?{}:{month:'short'}),day:'numeric',year:'numeric'});
  return `${left} — ${right}`;
};
const timeLabel = d => d.toLocaleTimeString([], {hour:'numeric',minute:d.getMinutes()?'2-digit':undefined});
const hoursLabel = value => {
  if (value < 1) return `${Math.round(value*60)}m`;
  const h = Math.floor(value), m = Math.round((value-h)*60);
  return m ? `${h}h ${m}m` : `${h}h`;
};
async function api(url, options={}) {
  const response = await fetch(url, { credentials:'same-origin', ...options });
  const data = await response.json().catch(()=>({}));
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
  return data;
}
const googleResponseCache = new Map();
const googleRequestsInFlight = new Map();
async function cachedGoogleApi(url, ttlMs, {force = false} = {}) {
  const cached = googleResponseCache.get(url);
  if (!force && cached && cached.expiresAt > Date.now()) return cached.value;
  if (cached) googleResponseCache.delete(url);
  if (googleRequestsInFlight.has(url)) return googleRequestsInFlight.get(url);
  const requestUrl = force ? `${url}${url.includes('?') ? '&' : '?'}refresh=1` : url;
  const pending = api(requestUrl).then(data => {
    googleResponseCache.set(url, { value: data, expiresAt: Date.now() + ttlMs });
    return data;
  }).finally(() => {
    if (googleRequestsInFlight.get(url) === pending) googleRequestsInFlight.delete(url);
  });
  googleRequestsInFlight.set(url, pending);
  return pending;
}
function readPropertyValue(property) {
  if (!property) return null;
  const value = property[property.type];
  if (property.type === 'checkbox') return Boolean(value);
  if (property.type === 'date') return value?.start || null;
  if (property.type === 'title' || property.type === 'rich_text') return (value || []).map(part => part.plain_text).join('');
  return value ?? null;
}
function getDailyHabitStatus(date, pagesByDate, habitProperties) {
  const key = dateKey(date);
  const row = pagesByDate.get(key);
  const habits = habitProperties.map(habit => {
    const property = habit.propertyName ? row?.properties?.[habit.propertyName] : null;
    return {
      habit: habit.label,
      propertyName: habit.propertyName,
      checked: property?.type === 'checkbox' ? Boolean(property.checkbox) : null
    };
  });
  const streakHabits = habits.filter(habit => habit.habit !== 'Hard conversations');
  return { date: key, rowPresent: Boolean(row), habits, allChecked: streakHabits.length === HABITS.length - 1 && streakHabits.every(habit => habit.checked === true) };
}
function calculateStreakEndingAt(date, pagesByDate, habitProperties) {
  const end = new Date(date);
  end.setHours(0, 0, 0, 0);
  let cursor = new Date(end);
  let count = 0;
  const evaluatedDays = [];
  while (evaluatedDays.length <= pagesByDate.size) {
    const status = getDailyHabitStatus(cursor, pagesByDate, habitProperties);
    evaluatedDays.push(status);
    if (!status.allChecked) break;
    count += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  const start = new Date(end);
  start.setDate(start.getDate() - count);
  const startDate = dateKey(start);
  return { endDate: dateKey(end), count, startDate, evaluatedDays };
}
function formatDate(value) {
  if (!value) return '—';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return String(value);
  return new Intl.DateTimeFormat('en-CA',{year:'numeric',month:'short',day:'2-digit',timeZone:'UTC'}).format(parsed);
}
const formatShortDate = value => {
  const parsed = new Date(`${value}T00:00:00`);
  return Number.isNaN(parsed.getTime()) ? '—' : parsed.toLocaleDateString('en-US',{month:'numeric',day:'numeric'});
};
function eventBounds(event) {
  const start = new Date(event.start?.dateTime || `${event.start?.date}T00:00:00`);
  const end = new Date(event.end?.dateTime || `${event.end?.date || event.start?.date}T00:00:00`);
  return { start, end, allDay: Boolean(event.start?.date && !event.start?.dateTime) };
}
function HabitMark({ checked }) {
  return checked
    ? <CheckCircle2 size={15} strokeWidth={2.1} className="checked-mark" />
    : <X size={15} strokeWidth={2.2} className="unchecked-mark" />;
}

function App() {
  const [auth, setAuth] = useState({ checked:false, connected:false, email:null });
  const [calendars, setCalendars] = useState([]);
  const [selected, setSelected] = useState([]);
  const [events, setEvents] = useState([]);
  const [week, setWeek] = useState(startOfWeek(new Date()));
  const [now, setNow] = useState(new Date());
  const [calendarBusy, setCalendarBusy] = useState(false);
  const [calendarError, setCalendarError] = useState('');
  const [notionError, setNotionError] = useState('');
  const [database, setDatabase] = useState(null);
  const [habitRows, setHabitRows] = useState([]);
  const [health, setHealth] = useState(null);

  const loadNotion = useCallback(async () => {
    setNotionError('');
    try {
      const [db, pageData] = await Promise.all([api('/api/notion/database'), api('/api/notion/pages')]);
      console.log('[Weekview] Notion database schema:', db.properties);
      console.log('[Weekview] Notion habit rows received:', pageData.results || []);
      setDatabase(db); setHabitRows(pageData.results || []);
    } catch (error) { setNotionError(error.message); }
  }, []);

  const loadCalendars = useCallback(async () => {
    setCalendarBusy(true); setCalendarError('');
    try {
      const data = await cachedGoogleApi('/api/google/calendars', 5 * 60 * 1000);
      setCalendars(data.calendars || []);
      setSelected(current => current.length ? current.filter(id => data.calendars.some(c=>c.id===id)) : (data.calendars||[]).map(c=>c.id));
    } catch (error) { setCalendarError(error.message); }
    finally { setCalendarBusy(false); }
  }, []);

  const loadWeek = useCallback(async ({isCurrent = () => true, force = false} = {}) => {
    if (!auth.connected) return;
    setCalendarBusy(true); setCalendarError('');
    try {
      const params = new URLSearchParams({ weekStart: week.toISOString() });
      const data = await cachedGoogleApi(`/api/google/week?${params.toString()}`, 60 * 1000, {force});
      if (isCurrent()) setEvents(data.events || []);
    } catch (error) { if (isCurrent()) setCalendarError(error.message); }
    finally { if (isCurrent()) setCalendarBusy(false); }
  }, [auth.connected, week]);

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    Promise.all([api('/api/auth/status'), api('/api/health')])
      .then(async ([status, serverHealth]) => {
        setAuth({ checked:true, connected:status.connected, email:status.email });
        setHealth(serverHealth);
        if (status.connected) await loadCalendars();
        await loadNotion();
      })
      .catch(error => {
        setAuth({ checked:true, connected:false, email:null });
        setNotionError(error.message);
      });
  }, [loadCalendars, loadNotion]);

  useEffect(() => {
    if (!auth.connected) return undefined;
    let current = true;
    loadWeek({isCurrent: () => current});
    return () => { current = false; };
  }, [auth.connected, week, loadWeek]);

  const propertyNames = useMemo(() => database ? Object.keys(database.properties || {}) : [], [database]);
  const dateProperty = useMemo(() => {
    if (!database) return null;
    return propertyNames.find(name => normalize(name) === 'date' && database.properties[name].type === 'date')
      || propertyNames.find(name => database.properties[name].type === 'date')
      || propertyNames.find(name => normalize(name).includes('date'))
      || propertyNames.find(name => database.properties[name].type === 'title') || null;
  }, [database, propertyNames]);
  const habitProperties = useMemo(() => {
    if (!database) return [];
    return HABITS.map(habit => {
      const aliases = habit.aliases.map(normalize);
      const exact = propertyNames.find(name => aliases.includes(normalize(name)));
      const fuzzy = exact || propertyNames.find(name => {
        const normalized = normalize(name);
        return aliases.some(alias => alias.length >= 4 && (normalized.includes(alias) || alias.includes(normalized)));
      });
      return { ...habit, propertyName: fuzzy || null };
    });
  }, [database, propertyNames]);
  const sortedRows = useMemo(() => [...habitRows].sort((a,b) => {
    const av = dateProperty ? readPropertyValue(a.properties?.[dateProperty]) : null;
    const bv = dateProperty ? readPropertyValue(b.properties?.[dateProperty]) : null;
    return (bv ? new Date(bv).getTime() : 0) - (av ? new Date(av).getTime() : 0);
  }), [habitRows, dateProperty]);
  const pagesByDate = useMemo(() => {
    const byDate = new Map();
    for (const row of sortedRows) {
      const dateValue = dateProperty ? row.properties?.[dateProperty] : null;
      const value = readPropertyValue(dateValue)
        || dateValue?.date?.start
        || row.properties?.date?.date?.start
        || null;
      if (!value) continue;
      const key = String(value).slice(0, 10);
      if (!byDate.has(key)) byDate.set(key, row);
    }
    return byDate;
  }, [sortedRows, dateProperty]);
  const visibleEvents = events.filter(event => selected.includes(event.calendarId));
  const categoryHours = useMemo(() => {
    const totals = new Map();
    for (const calendar of calendars) totals.set(calendar.id, 0);
    for (const event of events) {
      const {start,end,allDay} = eventBounds(event);
      if (allDay || !Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())) continue;
      const clippedStart = Math.max(start.getTime(), week.getTime());
      const clippedEnd = Math.min(end.getTime(), week.getTime()+7*DAY_MS);
      if (clippedEnd > clippedStart) totals.set(event.calendarId, (totals.get(event.calendarId)||0)+(clippedEnd-clippedStart)/3600000);
    }
    return calendars.map(c => ({...c, hours:totals.get(c.id)||0})).sort((a,b)=>b.hours-a.hours);
  }, [events, calendars, week]);

  const days = useMemo(() => Array.from({length:7},(_,i)=>new Date(week.getTime()+i*DAY_MS)), [week]);
  const recordByDate = useMemo(() => {
    const history = new Map();
    let previousDate = null;
    let runningStreak = 0;
    let record = 0;
    for (const key of [...pagesByDate.keys()].sort()) {
      const day = new Date(`${key}T00:00:00`);
      if (previousDate) {
        const expected = new Date(previousDate);
        expected.setDate(expected.getDate() + 1);
        if (dateKey(expected) !== key) runningStreak = 0;
      }
      const status = getDailyHabitStatus(day, pagesByDate, habitProperties);
      runningStreak = status.allChecked ? runningStreak + 1 : 0;
      record = Math.max(record, runningStreak);
      history.set(key, record);
      previousDate = day;
    }
    return history;
  }, [pagesByDate, habitProperties]);
  const streakByDate = useMemo(() => days.map(day => ({
    ...calculateStreakEndingAt(day, pagesByDate, habitProperties),
    dailyStatus: getDailyHabitStatus(day, pagesByDate, habitProperties),
    record: [...recordByDate].reduce((result, [key, value]) => key <= dateKey(day) ? value : result, 0)
  })), [days, pagesByDate, habitProperties, recordByDate]);
  const currentStreak = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const referenceDate = pagesByDate.has(dateKey(today)) ? today : new Date(today.getTime() - DAY_MS);
    return calculateStreakEndingAt(referenceDate, pagesByDate, habitProperties);
  }, [pagesByDate, habitProperties]);
  useEffect(() => {
    const style = 'color:#2563eb;font-weight:700';
    console.groupCollapsed('%c[Weekview] Streak calculation debug', style);
    console.log('%cPURPOSE%c Show source checks and calculated streak result.', style, 'color:inherit');
    console.log('%cVARIABLE: dateProperty%c', style, 'color:inherit', dateProperty);
    console.log('%cVARIABLE: matchedHabitProperties%c', style, 'color:inherit', habitProperties.map(({label, propertyName}) => ({label, propertyName})));
    console.log('%cVARIABLE: loadedNotionDates%c', style, 'color:inherit', [...pagesByDate.keys()].sort());
    console.log('%cVARIABLE: selectedWeekDailyChecks%c (true means every habit is checked)', style, 'color:inherit');
    console.table(streakByDate.map(({dailyStatus, count, startDate, record}) => ({
      date: dailyStatus.date,
      rowPresent: dailyStatus.rowPresent,
      allHabitsChecked: dailyStatus.allChecked,
      streakResult: count,
      startDateResult: startDate,
      recordResult: record,
      checksByHabit: dailyStatus.habits.map(h => `${h.habit}=${h.checked === null ? 'missing' : h.checked}`).join(' | ')
    })));
    console.log('%cVARIABLE: currentStreakResult%c', style, 'color:inherit', currentStreak);
    console.groupEnd();
  }, [dateProperty, habitProperties, pagesByDate, streakByDate, currentStreak]);
  const hours = Array.from({length:24},(_,i)=>i);
  const currentWeek = dateKey(week) === dateKey(startOfWeek(new Date()));
  const dayEvents = (day) => visibleEvents.filter(event => {
    const {start,end,allDay} = eventBounds(event);
    const dayStart = new Date(day); dayStart.setHours(0,0,0,0);
    const dayEnd = new Date(dayStart.getTime()+DAY_MS);
    return allDay ? start < dayEnd && end > dayStart : start < dayEnd && end > dayStart;
  });
  const eventStyle = (event, day) => {
    const {start,end} = eventBounds(event);
    const dayStart = new Date(day); dayStart.setHours(0,0,0,0);
    const dayEnd = new Date(dayStart.getTime()+DAY_MS);
    const clippedStart = new Date(Math.max(start.getTime(),dayStart.getTime()));
    const clippedEnd = new Date(Math.min(end.getTime(),dayEnd.getTime()));
    const top = (clippedStart.getHours()*60+clippedStart.getMinutes())/60*44;
    const duration = Math.max(0.5,(clippedEnd-clippedStart)/3600000);
    return { top:`${top}px`, height:`${Math.max(22,duration*44-2)}px`, background:event.calendarColor || '#777' };
  };
  const goWeek = delta => setWeek(current => new Date(current.getTime()+delta*7*DAY_MS));
  const jumpRelative = (amount, unit) => setWeek(current => {
    const target = new Date(current);
    if (unit === 'week') target.setDate(target.getDate() + amount * 7);
    if (unit === 'month') {
      const dayOfMonth = target.getDate();
      target.setDate(1);
      target.setMonth(target.getMonth() + amount);
      target.setDate(Math.min(dayOfMonth, new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate()));
    }
    if (unit === 'year') target.setFullYear(target.getFullYear() + amount);
    return startOfWeek(target);
  });
  const toggleCalendar = id => setSelected(old => old.includes(id) ? old.filter(x=>x!==id) : [...old,id]);
  const signOut = async () => {
    await api('/api/auth/logout',{method:'POST'});
    setAuth({checked:true,connected:false,email:null}); setEvents([]); setCalendars([]); setSelected([]);
  };
  if (!auth.checked) return <div className="boot"><div className="boot-mark"><CalendarDays size={22}/></div><span>Opening Weekview…</span></div>;

  if (!auth.connected) return <div className="login-shell">
    <div className="login-brand"><span className="brand-icon"><CalendarDays size={19}/></span><b>weekview</b></div>
    <section className="login-card">
      <div className="login-symbol"><CalendarDays size={30}/></div>
      <p className="eyebrow">YOUR WEEK, IN ONE PLACE</p>
      <h1>A calmer view of your time.</h1>
      <p>Connect Google Calendar to open your weekly schedule, category totals, and Notion habit log.</p>
      <a className="google-button" href="/api/auth/google"><span className="google-g">G</span> Continue with Google <ArrowUpRight size={15}/></a>
      <div className="login-foot"><LockKeyhole size={13}/> Read-only Google Calendar access</div>
      {health && !health.googleConfigured && <div className="inline-error">Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to your server .env file.</div>}
      {new URLSearchParams(location.search).get('googleError') && <div className="inline-error">{new URLSearchParams(location.search).get('googleError')}</div>}
      <div className="login-note">Your Google session is stored server-side and renewed automatically when the access token expires.</div>
    </section>
  </div>;

  return <div className="app-shell">
    <header className="topbar">
      <div className="brand"><span className="brand-icon"><CalendarDays size={19}/></span><b>weekview</b><span className="brand-divider">/</span><span className="brand-sub">Personal dashboard</span></div>
      <div className="topbar-center"><span className="live-dot"/><span>WEEKLY OVERVIEW</span></div>
    <div className="topbar-actions">
        <span className="account-label">{auth.email || 'Google connected'}</span>
        <button className="icon-button" title="Refresh all data" onClick={()=>{loadWeek({force:true});loadNotion();}}><RefreshCw size={15}/></button>
        <button className="signout" onClick={signOut}><LogOut size={14}/> Sign out</button>
      </div>
    </header>

    <main className="dashboard">
      <aside className="sidebar">
        <div className="streak-summary-card">
          <div><p className="eyebrow">ALL HABITS</p><h2>Streak</h2></div>
          <div className="streak-summary-values"><div><strong>{currentStreak.count}</strong><span>Current days</span></div><div><strong>57</strong><span>Record</span></div></div>
          <small>{currentStreak.startDate ? `Started ${formatDate(currentStreak.startDate)}` : 'Complete all habits to start a streak'}</small>
        </div>
        <div className="section-heading"><div><p className="eyebrow">TIME ALLOCATION</p><h2>Categories</h2></div><span className="week-chip">THIS WEEK</span></div>
        <p className="section-description">Hours are calculated from the duration of events in each Google Calendar.</p>
        {calendarError && <div className="inline-error">{calendarError}</div>}
        <div className="category-list">
          {categoryHours.map(calendar => <button className={`category-row ${selected.includes(calendar.id)?'active':''}`} key={calendar.id} onClick={()=>toggleCalendar(calendar.id)}>
            <span className="category-color" style={{background:calendar.color}}/>
            <span className="category-name">{calendar.name}</span>
            <span className="category-hours">{hoursLabel(calendar.hours)}</span>
          </button>)}
          {!categoryHours.length && <div className="empty-state">{calendarBusy?'Loading calendars…':'No calendars found.'}</div>}
        </div>
        <div className="sidebar-bottom">
          <div className="total-card"><span>Total scheduled time</span><strong>{hoursLabel(categoryHours.filter(c=>selected.includes(c.id)).reduce((sum,c)=>sum+c.hours,0))}</strong><small>Selected calendars · current week</small></div>
          <div className="connection-status"><span><Cloud size={14}/> Google Calendar</span><b>Connected</b></div>
          <div className="connection-status"><span><Database size={14}/> Notion habits</span><b className={database?'connected-text':'muted-text'}>{database?'Connected':'Unavailable'}</b></div>
          {notionError && <div className="small-error">{notionError}</div>}
        </div>
      </aside>

      <section className="right-column">
        <section className="calendar-panel">
          <div className="panel-heading">
            <div><p className="eyebrow">GOOGLE CALENDAR</p><h2>{formatRange(week)}</h2></div>
            <div className="calendar-controls">
              <label className="calendar-jump-date"><span>Go to</span><input type="date" value={dateKey(week)} aria-label="Go to week containing date" onChange={event=>{if(event.target.value)setWeek(startOfWeek(new Date(`${event.target.value}T00:00:00`)));}}/></label>
              <select className="calendar-jump-select" aria-label="Jump relative to this week" value="" onChange={event=>{const [amount,unit]=event.target.value.split(':');if(unit)jumpRelative(Number(amount),unit);}}>
                <option value="">Jump…</option><option value="-1:week">−1 week</option><option value="-1:month">−1 month</option><option value="-1:year">−1 year</option><option value="1:week">+1 week</option><option value="1:month">+1 month</option><option value="1:year">+1 year</option>
              </select>
              <button onClick={()=>setWeek(startOfWeek(new Date()))}>Today</button>
              <button className="arrow-control" aria-label="Previous week" onClick={()=>goWeek(-1)}><ChevronLeft size={16}/></button>
              <button className="arrow-control" aria-label="Next week" onClick={()=>goWeek(1)}><ChevronRight size={16}/></button>
            </div>
          </div>
          <div className="calendar-scroll">
            <div className="calendar-grid">
              <div className="calendar-all-day">
                <div className="time-gutter">ALL DAY</div>
                {days.map(day=><div className="all-day-cell" key={dateKey(day)}>{dayEvents(day).filter(e=>eventBounds(e).allDay).map(e=><div className="all-day-event" key={e.id} style={{background:e.calendarColor}}>{e.summary||'Untitled'}</div>)}</div>)}
              </div>
              <div className="calendar-days-header"><div className="time-gutter"/>{days.map(day=><div key={dateKey(day)} className={`day-header ${dateKey(day)===dateKey(now)?'today':''}`}><span>{day.toLocaleDateString('en-US',{weekday:'short'}).toUpperCase()}</span><b>{day.getDate()}</b></div>)}</div>
              <div className="calendar-time-grid">
                <div className="time-gutter hour-labels">{hours.map(hour=><div key={hour}>{hour===0?'':new Date(2000,0,1,hour).toLocaleTimeString('en-US',{hour:'numeric'})}</div>)}</div>
                {days.map(day=><div className={`day-column ${dateKey(day)===dateKey(now)?'today':''}`} key={dateKey(day)}>
                  {hours.map(hour=><div className="hour-line" key={hour}/>)}
                  {dayEvents(day).filter(e=>!eventBounds(e).allDay).map(event=><div className="event-card" key={`${event.calendarId}-${event.id}-${dateKey(day)}`} style={eventStyle(event,day)} title={`${event.summary||'Untitled'} · ${timeLabel(eventBounds(event).start)}`}><b>{event.summary||'Untitled'}</b><span>{timeLabel(eventBounds(event).start)} – {timeLabel(eventBounds(event).end)}</span></div>)}
                </div>)}
              </div>
            </div>
          </div>
          <div className="panel-foot"><span><LockKeyhole size={12}/> Read-only calendar</span><span>{visibleEvents.length} events {calendarBusy?'· syncing':''}</span></div>
        </section>

        <section className="habits-panel">
          {notionError && <div className="notion-error">{notionError}</div>}
          <div className="habits-table-scroll">
            <table className="habit-table">
              <tbody>
                {HABITS.map((habit,index)=> <tr key={habit.label}><td className="habit-name-cell" title={habit.label} aria-label={habit.label}><habit.icon size={15} strokeWidth={1.8}/></td>{days.map(day=>{
                    const row=pagesByDate.get(dateKey(day));
                    const propertyName=habitProperties[index]?.propertyName;
                    const prop=propertyName?row?.properties?.[propertyName]:null;
                    const checked=prop?.type==='checkbox'?Boolean(prop.checkbox):false;
                    return <td className="habit-day-cell" key={dateKey(day)}>{row&&propertyName&&prop?.type==='checkbox'?<HabitMark checked={checked}/>:<span className="missing-mark">—</span>}</td>;
                  })}</tr>)}
                <tr className="streak-row"><td className="habit-name-cell streak-label" title="Streak">Streak</td>{streakByDate.map(item=><td className="streak-day-cell" key={item.endDate}>{item.count}</td>)}</tr>
                <tr className="streak-start-row"><td className="habit-name-cell streak-label" title="Start date">Start</td>{streakByDate.map(item=><td className="streak-day-cell start-date-cell" key={item.endDate}>{formatShortDate(item.startDate)}</td>)}</tr>
                <tr className="streak-record-row"><td className="habit-name-cell streak-label" title="Record">Record</td>{streakByDate.map(item=><td className="streak-day-cell" key={item.endDate}>{item.record}</td>)}</tr>
              </tbody>
            </table>
          </div>
          {database && habitProperties.some(h=>!h.propertyName) && <div className="mapping-note">Not matched in Notion: {habitProperties.filter(h=>!h.propertyName).map(h=>h.label).join(', ')}. Share the exact Notion column names and I’ll map them.</div>}
        </section>
      </section>
    </main>
  </div>;
}

createRoot(document.getElementById('root')).render(<React.StrictMode><App/></React.StrictMode>);
