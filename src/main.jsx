import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  CalendarDays, ChevronLeft, ChevronRight, RefreshCw, LogOut, Clock3,
  CheckCircle2, Circle, LockKeyhole, LoaderCircle, AlertCircle, Cloud,
  Database, ArrowUpRight
} from 'lucide-react';
import './style.css';

const DAY_MS = 86400000;
const HABITS = [
  { label: 'No J.O.', aliases: ['no j.o', 'no jo'] },
  { label: 'No E.N.T.', aliases: ['no e.n.t', 'no ent'] },
  { label: '5 a.m.', aliases: ['5 a.m', '5am'] },
  { label: 'No S.W.', aliases: ['no s.w', 'no sw'] },
  { label: 'No F.D.D.', aliases: ['no f.d.d', 'no fdd'] },
  { label: 'Cold showers', aliases: ['cold showers', 'cold shower'] },
  { label: 'Workout', aliases: ['workout', 'work out'] },
  { label: 'Hard conversations', aliases: ['hard conversations', 'hard conversation'] },
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
function readPropertyValue(property) {
  if (!property) return null;
  const value = property[property.type];
  if (property.type === 'checkbox') return Boolean(value);
  if (property.type === 'date') return value?.start || null;
  if (property.type === 'title' || property.type === 'rich_text') return (value || []).map(part => part.plain_text).join('');
  return value ?? null;
}
function formatDate(value) {
  if (!value) return '—';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return String(value);
  return new Intl.DateTimeFormat('en-CA',{year:'numeric',month:'short',day:'2-digit',timeZone:'UTC'}).format(parsed);
}
function eventBounds(event) {
  const start = new Date(event.start?.dateTime || `${event.start?.date}T00:00:00`);
  const end = new Date(event.end?.dateTime || `${event.end?.date || event.start?.date}T00:00:00`);
  return { start, end, allDay: Boolean(event.start?.date && !event.start?.dateTime) };
}
function HabitMark({ checked }) {
  return checked
    ? <CheckCircle2 size={15} strokeWidth={2.1} className="checked-mark" />
    : <Circle size={15} strokeWidth={1.5} className="unchecked-mark" />;
}

function App() {
  const [auth, setAuth] = useState({ checked:false, connected:false, email:null });
  const [calendars, setCalendars] = useState([]);
  const [selected, setSelected] = useState([]);
  const [events, setEvents] = useState([]);
  const [week, setWeek] = useState(startOfWeek(new Date()));
  const [now, setNow] = useState(new Date());
  const [calendarBusy, setCalendarBusy] = useState(false);
  const [notionBusy, setNotionBusy] = useState(false);
  const [calendarError, setCalendarError] = useState('');
  const [notionError, setNotionError] = useState('');
  const [database, setDatabase] = useState(null);
  const [habitRows, setHabitRows] = useState([]);
  const [health, setHealth] = useState(null);

  const loadNotion = useCallback(async () => {
    setNotionBusy(true); setNotionError('');
    try {
      const [db, pageData] = await Promise.all([api('/api/notion/database'), api('/api/notion/pages')]);
      setDatabase(db); setHabitRows(pageData.results || []);
    } catch (error) { setNotionError(error.message); }
    finally { setNotionBusy(false); }
  }, []);

  const loadCalendars = useCallback(async () => {
    setCalendarBusy(true); setCalendarError('');
    try {
      const data = await api('/api/google/calendars');
      setCalendars(data.calendars || []);
      setSelected(current => current.length ? current.filter(id => data.calendars.some(c=>c.id===id)) : (data.calendars||[]).map(c=>c.id));
    } catch (error) { setCalendarError(error.message); }
    finally { setCalendarBusy(false); }
  }, []);

  const loadWeek = useCallback(async () => {
    if (!auth.connected) return;
    setCalendarBusy(true); setCalendarError('');
    try {
      const params = new URLSearchParams({ weekStart: week.toISOString() });
      const data = await api(`/api/google/week?${params.toString()}`);
      setEvents(data.events || []);
    } catch (error) { setCalendarError(error.message); }
    finally { setCalendarBusy(false); }
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
    if (auth.connected) loadWeek();
  }, [auth.connected, week, loadWeek]);

  const propertyNames = useMemo(() => database ? Object.keys(database.properties || {}) : [], [database]);
  const dateProperty = useMemo(() => {
    if (!database) return null;
    return propertyNames.find(name => database.properties[name].type === 'date')
      || propertyNames.find(name => normalize(name).includes('date'))
      || propertyNames.find(name => database.properties[name].type === 'title') || null;
  }, [database, propertyNames]);
  const habitProperties = useMemo(() => {
    if (!database) return [];
    return HABITS.map(habit => {
      const aliases = habit.aliases.map(normalize);
      return { ...habit, propertyName: propertyNames.find(name => aliases.includes(normalize(name))) || null };
    });
  }, [database, propertyNames]);
  const sortedRows = useMemo(() => [...habitRows].sort((a,b) => {
    const av = dateProperty ? readPropertyValue(a.properties?.[dateProperty]) : null;
    const bv = dateProperty ? readPropertyValue(b.properties?.[dateProperty]) : null;
    return (bv ? new Date(bv).getTime() : 0) - (av ? new Date(av).getTime() : 0);
  }), [habitRows, dateProperty]);

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
  const goWeek = delta => setWeek(new Date(week.getTime()+delta*7*DAY_MS));
  const toggleCalendar = id => setSelected(old => old.includes(id) ? old.filter(x=>x!==id) : [...old,id]);
  const signOut = async () => {
    await api('/api/auth/logout',{method:'POST'});
    setAuth({checked:true,connected:false,email:null}); setEvents([]); setCalendars([]); setSelected([]);
  };
  const habitMatched = habitProperties.filter(h=>h.propertyName).length;

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
        <button className="icon-button" title="Refresh all data" onClick={()=>{loadWeek();loadNotion();}}><RefreshCw size={15}/></button>
        <button className="signout" onClick={signOut}><LogOut size={14}/> Sign out</button>
      </div>
    </header>

    <main className="dashboard">
      <aside className="sidebar">
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
          <div className="habits-panel-heading">
            <div><p className="eyebrow">NOTION · DAILY LOG</p><h2>Habits</h2></div>
            <div className="habits-meta">{database ? `${sortedRows.length} days · ${habitMatched}/8 columns matched` : 'Waiting for Notion'}</div>
            <button className="refresh-habits" onClick={loadNotion} disabled={notionBusy}>{notionBusy?<LoaderCircle size={14} className="spin"/>:<RefreshCw size={14}/>} Refresh</button>
          </div>
          {notionError && <div className="notion-error">{notionError}</div>}
          <div className="habits-table-scroll">
            <table className="habit-table">
              <thead><tr><th className="date-col">Date</th>{HABITS.map(h=><th key={h.label}>{h.label}</th>)}</tr></thead>
              <tbody>
                {sortedRows.slice(0,12).map(row=>{
                  const dateValue=dateProperty?readPropertyValue(row.properties?.[dateProperty]):null;
                  return <tr key={row.id}><td className="date-cell">{formatDate(dateValue)}</td>{habitProperties.map(h=>{
                    const prop=h.propertyName?row.properties?.[h.propertyName]:null;
                    const checked=prop?.type==='checkbox'?Boolean(prop.checkbox):false;
                    return <td key={h.label}>{h.propertyName&&prop?.type==='checkbox'?<HabitMark checked={checked}/>:<span className="missing-mark">—</span>}</td>;
                  })}</tr>;
                })}
                {!sortedRows.length && <tr><td colSpan={9} className="empty-habits">{notionBusy?'Loading Notion habits…':'No habit rows available.'}</td></tr>}
              </tbody>
            </table>
          </div>
          {habitMatched<8 && database && <div className="mapping-note">Some habit columns did not match their expected names. Unmatched columns are shown as dashes.</div>}
        </section>
      </section>
    </main>
  </div>;
}

createRoot(document.getElementById('root')).render(<React.StrictMode><App/></React.StrictMode>);
