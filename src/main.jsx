import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  CalendarDays, ChevronLeft, ChevronRight, RefreshCw, LogOut,
  CheckCircle2, Circle, X, LockKeyhole, AlertCircle, Cloud,
  Database, ArrowUpRight, UserRound, Tv, Sunrise, Cigarette,
  Sandwich, ShowerHead, Dumbbell, MessagesSquare, Network as NetworkIcon,
  Building2, GitBranch, Plus
} from 'lucide-react';
import './style.css';

const DAY_MS = 86400000;
const FINANCE_DATABASE_ID = '2ee37c615d338118a78be3164e57c360';
const FINANCE_VIEW_ID = '2ee37c615d3381ac828f000c817ea903';
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
const ASSET_BUCKETS = [
  { key:'checking', label:'Checking', color:'#4f8a69' },
  { key:'stocks', label:'Stocks', color:'#5978d6' },
  { key:'bitcoin', label:'Bitcoin', color:'#e1a343' },
  { key:'ethereum', label:'ETH', color:'#8268c5' },
  { key:'solana', label:'Sol', color:'#4a9c91' },
  { key:'inventory', label:'Inventory', color:'#d27a5e' },
  { key:'owed', label:'Owed to me', color:'#b9698d' },
  { key:'giftCards', label:'Gift cards', color:'#b1984b' },
  { key:'taxes', label:'Taxes', color:'#818d63' },
];
const CREDIT_BUCKETS = [
  { key:'rbcMastercard', label:'RBC Mastercard' },
  { key:'rbcCardTwo', label:'Other RBC card' },
  { key:'amex', label:'Amex' },
  { key:'rbcLoc', label:'RBC LOC' },
];
const RETIREMENT_BUCKETS = ['TFSA','FHSA','RRSP'];
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
const money = value => new Intl.NumberFormat('en-CA',{style:'currency',currency:'CAD',maximumFractionDigits:2}).format(Number(value)||0);
const inputNumber = value => Number.parseFloat(value) || 0;
function notionValue(property) {
  if (!property) return null;
  const value = property[property.type];
  if (property.type === 'title' || property.type === 'rich_text') return (value || []).map(part=>part.plain_text || '').join('');
  if (property.type === 'date') return value?.start || null;
  if (property.type === 'select' || property.type === 'status') return value?.name || null;
  if (property.type === 'number') return value ?? null;
  if (property.type === 'formula') return value?.[value?.type] ?? null;
  return value ?? null;
}
function FinanceNumberInput({label,value,onChange,placeholder='0'}) {
  return <label className="finance-input-label"><span>{label}</span><span className="finance-input-wrap"><span>$</span><input type="number" min="0" step="0.01" inputMode="decimal" placeholder={placeholder} value={value ?? ''} onChange={event=>onChange(event.target.value)}/></span></label>;
}
function MonthlyFinanceTable({title,kind,transactions,budgets={},onBudgetChange}) {
  const matching = transactions.filter(tx=>tx.kind===kind);
  const categoryFor = tx => (kind==='expense'?tx.expense2:tx.category) || tx.category || 'Uncategorized';
  const categories = [...new Set([
    ...matching.map(categoryFor),
    ...(kind==='expense'?Object.keys(budgets):[])
  ])].sort((a,b)=>a.localeCompare(b));
  const monthly = categories.map(category=>{
    const values = Array(12).fill(0);
    for (const tx of matching) {
      if (categoryFor(tx)===category && tx.monthIndex>=0) values[tx.monthIndex] += Math.abs(tx.amount);
    }
    const total=values.reduce((sum,value)=>sum+value,0);
    const hasBudget=kind==='expense'&&budgets[category]!==undefined&&String(budgets[category])!=='';
    const budget=hasBudget?inputNumber(budgets[category]):0;
    return {category,values,total,hasBudget,budget,margin:budget-total};
  });
  const monthTotals=Array(12).fill(0);
  for(const row of monthly) row.values.forEach((value,index)=>{monthTotals[index]+=value;});
  const yearTotal=monthly.reduce((sum,row)=>sum+row.total,0);
  const budgetedRows=monthly.filter(row=>row.hasBudget);
  const totalBudget=budgetedRows.reduce((sum,row)=>sum+row.budget,0);
  const totalMargin=budgetedRows.reduce((sum,row)=>sum+row.margin,0);
  const marginClass=value=>value<0?'negative':value>0?'positive':'zero';
  return <section className="finance-section">
    <div className="finance-section-title"><div><p className="eyebrow">2026 BY MONTH</p><h2>{title}</h2></div><span className="finance-section-meta">{matching.length} transactions</span></div>
    <div className="finance-monthly-scroll"><table className="finance-monthly-table"><thead><tr><th>Category</th>{Array.from({length:12},(_,i)=><th key={i}>{new Date(2026,i,1).toLocaleDateString('en-US',{month:'short'})}</th>)}{kind==='expense'&&<th>Budget</th>}<th>Total</th>{kind==='expense'&&<th>Margin</th>}</tr></thead><tbody>
      {monthly.map(row=><tr key={row.category}><th scope="row">{row.category}</th>{row.values.map((value,index)=><td key={index}>{value?money(value):'—'}</td>)}{kind==='expense'&&<td className="finance-budget-cell"><span>$</span><input type="number" min="0" step="0.01" inputMode="decimal" aria-label={`Annual budget for ${row.category}`} placeholder="0" value={budgets[row.category]??''} onChange={event=>onBudgetChange(row.category,event.target.value)}/></td>}<td className="finance-row-total">{money(row.total)}</td>{kind==='expense'&&<td className={`finance-margin ${row.hasBudget?marginClass(row.margin):'unset'}`}>{row.hasBudget?money(row.margin):'—'}</td>}</tr>)}
      {kind==='expense'&&!!monthly.length&&<tr className="finance-month-total"><th scope="row">Total</th>{monthTotals.map((value,index)=><td key={index}>{value?money(value):'—'}</td>)}<td>{budgetedRows.length?money(totalBudget):'—'}</td><td className="finance-row-total">{money(yearTotal)}</td><td className={`finance-margin ${budgetedRows.length?marginClass(totalMargin):'unset'}`}>{budgetedRows.length?money(totalMargin):'—'}</td></tr>}
      {!monthly.length && <tr><td colSpan={kind==='expense'?16:14} className="finance-table-empty">No {kind} transactions found for 2026.</td></tr>}
    </tbody></table></div>
    {kind==='expense' && <p className="finance-budget-note">Enter an annual budget for each category. Margin = budget minus yearly spending.</p>}
  </section>;
}
function FinancePage({database,transactions,loading,error,onRetry,inputs,onInput,storageStatus,storageError,annotations,annotationStatus,annotationError,onExpenseCategory,onExpenseBudget}) {
  const assets = ASSET_BUCKETS.map(bucket=>({...bucket,amount:inputNumber(inputs[`asset:${bucket.key}`])}));
  const netWorth = assets.reduce((sum,item)=>sum+item.amount,0);
  let cursor = 0;
  const chart = netWorth ? `conic-gradient(${assets.map(item=>{
    const from=cursor; cursor += item.amount/netWorth*100; return `${item.color} ${from}% ${cursor}%`;
  }).join(',')})` : 'conic-gradient(#e9ece8 0% 100%)';
  const credit = CREDIT_BUCKETS.map(item=>({...item,amount:inputNumber(inputs[`credit:${item.key}`])}));
  const creditTotal = credit.reduce((sum,item)=>sum+item.amount,0);
  const propertyNames = database?.properties?.map(property=>property.name) || [];
  const chooseProperty = (names,aliases) => names.find(name=>aliases.includes(normalize(name))) || null;
  const itemProperty = chooseProperty(propertyNames,['item','name','transaction','description']);
  const dateProperty = chooseProperty(propertyNames,['date','transactiondate']);
  const amountProperty = chooseProperty(propertyNames,['amount','total']);
  const typeProperty = chooseProperty(propertyNames,['type','transactiontype']);
  const categoryProperty = chooseProperty(propertyNames,['expensecategory','incomecategory','category']);
  const categorySchema = database?.properties?.find(property=>normalize(property.name)===normalize(categoryProperty||''));
  const transactionRows = transactions.map(page=>{
    const properties=page.properties || {};
    const read=name=>name?notionValue(properties[name]):null;
    const date=String(read(dateProperty) || '').slice(0,10);
    const type=String(read(typeProperty) || '');
    const lowerType=type.toLowerCase();
    const kind=lowerType.includes('income') ? 'income' : lowerType.includes('expense') ? 'expense' : 'other';
    const category=String(read(categoryProperty)||'Uncategorized');
    const expense2=annotations?.expenseCategories?.[page.id]??category;
    return {id:page.id,item:String(read(itemProperty) || 'Untitled'),date,type,category,expense2,amount:Number(read(amountProperty)||0),kind,monthIndex:date.startsWith('2026-')?Number(date.slice(5,7))-1:-1};
  }).filter(tx=>tx.date.startsWith('2026-')).sort((a,b)=>b.date.localeCompare(a.date));
  const expense2Options=[...new Set([...(categorySchema?.options||[]),...transactionRows.filter(tx=>tx.kind==='expense').map(tx=>tx.expense2).filter(Boolean)])].sort((a,b)=>a.localeCompare(b));
  const assetShare = assets.map(item=>({...item,percent:netWorth?item.amount/netWorth*100:0}));
  return <main className="finance-dashboard">
    <section className="finance-section net-worth-section">
      <div className="finance-page-heading"><div><p className="eyebrow">PERSONAL FINANCE · 2026</p><h1>Net worth</h1></div><span className="finance-live-status">{database ? `${transactions.length} Notion transactions loaded` : loading ? 'Connecting to Notion…' : 'Notion unavailable'}</span></div>
      <div className={`finance-storage-status ${storageStatus==='error' || storageStatus==='unavailable'?'is-error':''}`} role="status">{storageStatus==='loading'?'Connecting to MongoDB Atlas…':storageStatus==='saving'?'Saving your finance inputs…':storageStatus==='error'||storageStatus==='unavailable'?storageError || 'Finance inputs could not be saved.':storageStatus==='saved'?'Saved to MongoDB Atlas.':'Atlas connected · edits save automatically.'}</div>
      <div className="net-worth-total"><span>Total assets</span><strong>{money(netWorth)}</strong><small>Calculated from the balances below · CAD</small></div>
      <div className="asset-layout">
        <div className="asset-input-grid">{ASSET_BUCKETS.map(bucket=><FinanceNumberInput key={bucket.key} label={bucket.label} value={inputs[`asset:${bucket.key}`]} onChange={value=>onInput(`asset:${bucket.key}`,value)}/>)}</div>
        <div className="asset-chart-area"><div className="asset-donut" style={{background:chart}}><div><strong>{money(netWorth)}</strong><span>Total assets</span></div></div><div className="asset-legend">{assetShare.map(item=><div className="asset-legend-item" key={item.key}><span className="asset-swatch" style={{background:item.color}}/><span>{item.label}</span><b>{item.percent.toFixed(1)}%</b></div>)}</div></div>
      </div>
    </section>

    <section className="finance-section credit-section">
      <div className="finance-section-title"><div><p className="eyebrow">CREDIT</p><h2>Credit balances</h2></div><strong className="finance-total-value">{money(creditTotal)}</strong></div>
      <label className="finance-score-input"><span>Credit score</span><input type="number" min="0" max="999" step="1" placeholder="—" value={inputs.creditScore ?? ''} onChange={event=>onInput('creditScore',event.target.value)}/></label>
      <div className="credit-input-grid">{credit.map(item=><div className="credit-account" key={item.key}><FinanceNumberInput label={item.label} value={inputs[`credit:${item.key}`]} onChange={value=>onInput(`credit:${item.key}`,value)}/><span>{creditTotal?(item.amount/creditTotal*100).toFixed(1):'0.0'}% of credit total</span></div>)}</div>
    </section>

    <section className="finance-section transactions-section">
      <div className="finance-section-title"><div><p className="eyebrow">NOTION TABLE</p><h2><span className="finance-year-highlight">2026</span> Transactions</h2></div><span className="finance-section-meta">{loading?'Loading…':`Most recent first · ${transactionRows.length} rows`}</span></div>
      {error && <div className="finance-error"><b>Notion connection issue</b><span>{error}</span><button onClick={onRetry}>Try again</button></div>}
      <div className={`finance-annotation-status ${annotationStatus==='error'?'is-error':''}`} role="status">{annotationStatus==='loading'?'Loading saved categories…':annotationStatus==='saving'?'Saving categories and budgets…':annotationStatus==='saved'?'Categories and budgets saved to Atlas.':annotationStatus==='error'?`Could not save category edits: ${annotationError||'check MongoDB Atlas connection.'}`:'Expense 2 categories and annual budgets save automatically.'}</div>
      <div className="finance-transaction-scroll" aria-label="2026 transactions, newest to oldest" tabIndex={0}><table className="finance-transactions"><thead><tr><th>Item</th><th>Amount</th><th>Date</th><th>Type</th><th>Expense / income category</th><th>Expense 2</th></tr></thead><tbody>
        {transactionRows.map(tx=><tr key={tx.id}><td>{tx.item}</td><td className={tx.kind==='income'?'income-amount':tx.kind==='expense'?'expense-amount':''}>{money(tx.amount)}</td><td>{tx.date || '—'}</td><td><span className={`transaction-kind ${tx.kind}`}>{tx.type || '—'}</span></td><td>{tx.category}</td><td>{tx.kind==='expense'?<select className="finance-category-select" aria-label={`Expense 2 category for ${tx.item}`} value={tx.expense2} disabled={annotationStatus==='loading'} onChange={event=>onExpenseCategory(tx.id,event.target.value)}>{!expense2Options.includes(tx.expense2)&&<option value={tx.expense2}>{tx.expense2}</option>}{expense2Options.map(option=><option key={option} value={option}>{option}</option>)}</select>:<span className="finance-secondary-category-empty">—</span>}</td></tr>)}
        {!transactionRows.length && <tr><td colSpan={6} className="finance-table-empty">{loading?'Loading transactions…':'No 2026 transaction rows found.'}</td></tr>}
      </tbody></table></div>
    </section>

    <MonthlyFinanceTable title="Expenses by month" kind="expense" transactions={transactionRows} budgets={annotations?.expenseBudgets||{}} onBudgetChange={onExpenseBudget}/>
    <MonthlyFinanceTable title="Income by month" kind="income" transactions={transactionRows}/>

    <section className="finance-section retirement-section">
      <div className="finance-section-title"><div><p className="eyebrow">SAVINGS & CONTRIBUTIONS</p><h2>Registered accounts</h2></div></div>
      <div className="retirement-grid">{RETIREMENT_BUCKETS.map(account=>{
        const limit=inputNumber(inputs[`limit:${account}`]);
        const contribution=inputNumber(inputs[`contribution:${account}`]);
        const remaining=Math.max(0,limit-contribution);
        const percent=limit?Math.min(100,contribution/limit*100):0;
        return <article className="retirement-card" key={account}><h3>{account}</h3><div className="retirement-inputs"><FinanceNumberInput label="Annual limit" value={inputs[`limit:${account}`]} onChange={value=>onInput(`limit:${account}`,value)}/><FinanceNumberInput label="Used" value={inputs[`contribution:${account}`]} onChange={value=>onInput(`contribution:${account}`,value)}/></div><div className="retirement-track"><span style={{width:`${percent}%`}}/></div><div className="retirement-summary"><span>{limit?`${percent.toFixed(1)}% used`:'Add a limit to see progress'}</span><b>{money(remaining)} remaining</b></div></article>;
      })}</div>
    </section>
  </main>;
}
const STRENGTH_LABELS = ['1 · Cold','2 · Email/social reply','3 · Text reply','4 · Call','5 · In person'];
function findNetworkPaths(graph, targetId) {
  if (!graph || !targetId) return [];
  const nodesById = new Map(graph.nodes.map(node=>[node.id,node]));
  const outgoing = new Map();
  for (const edge of graph.edges) outgoing.set(edge.from,[...(outgoing.get(edge.from)||[]),edge]);
  const paths = [];
  const walk = (nodeId,nodePath,edgePath,seen,potential) => {
    if (nodeId===targetId) {
      paths.push({nodes:nodePath.map(id=>nodesById.get(id)).filter(Boolean),edges:edgePath,potential});
      return;
    }
    if (nodePath.length>=9 || paths.length>=20) return;
    for (const edge of outgoing.get(nodeId)||[]) {
      if (seen.has(edge.to)) continue;
      const nextSeen=new Set(seen); nextSeen.add(edge.to);
      walk(edge.to,[...nodePath,edge.to],[...edgePath,edge],nextSeen,potential||edge.status==='potential');
    }
  };
  walk('you',['you'],[],new Set(['you']),false);
  return paths;
}
function NetworkNodePill({node}) {
  return <div className={`network-node-pill ${node.type}`}><span className="network-node-icon">{node.type==='organization'?<Building2 size={15}/>:<UserRound size={15}/>}</span><b>{node.name}</b>{node.type==='person'&&node.id!=='you'&&<span className="network-level-badge">{node.strength?`L${node.strength}`:'Unrated'}</span>}</div>;
}
function NetworkPage({graph,loading,error,onRetry,onAddNode,onAddEdge,onStrengthChange,saveStatus}) {
  const [targetId,setTargetId]=useState('la-leakers');
  const [newName,setNewName]=useState('');
  const [newType,setNewType]=useState('person');
  const [edgeFrom,setEdgeFrom]=useState('you');
  const [edgeTo,setEdgeTo]=useState('');
  const [edgeLabel,setEdgeLabel]=useState('');
  const [edgeStatus,setEdgeStatus]=useState('confirmed');
  const nodes=graph?.nodes||[];
  const people=nodes.filter(node=>node.id!=='you'&&node.type==='person');
  const paths=useMemo(()=>findNetworkPaths(graph,targetId),[graph,targetId]);
  const youNode=nodes.find(node=>node.id==='you');
  const selectedTarget=nodes.find(node=>node.id===targetId);
  useEffect(()=>{
    if(nodes.length&&!nodes.some(node=>node.id===targetId)) setTargetId(nodes.find(node=>node.id!=='you')?.id||'');
    if(nodes.length&&!nodes.some(node=>node.id===edgeFrom)) setEdgeFrom('you');
    if(nodes.length&&!nodes.some(node=>node.id===edgeTo)) setEdgeTo(nodes.find(node=>node.id!=='you')?.id||'');
  },[nodes,targetId,edgeFrom,edgeTo]);
  const addNode=event=>{
    event.preventDefault();
    const name=newName.trim(); if(!name)return;
    const id=`node-${globalThis.crypto?.randomUUID?.()||`${Date.now()}-${Math.random().toString(36).slice(2)}`}`;
    onAddNode({id,name,type:newType,strength:null});
    setTargetId(id); setEdgeTo(id); setNewName('');
  };
  const addEdge=event=>{
    event.preventDefault();
    if(!edgeFrom||!edgeTo||edgeFrom===edgeTo||!edgeLabel.trim())return;
    const id=`edge-${globalThis.crypto?.randomUUID?.()||`${Date.now()}-${Math.random().toString(36).slice(2)}`}`;
    onAddEdge({id,from:edgeFrom,to:edgeTo,label:edgeLabel.trim(),status:edgeStatus});
    setEdgeLabel('');
  };
  return <main className="network-page">
    <section className="network-hero">
      <div className="network-title-row"><div><p className="eyebrow">RELATIONSHIP MAP</p><h1>Network</h1><p>Map the paths from you to the people and organizations you want to reach.</p></div><div className={`network-save-state ${saveStatus==='error'?'is-error':''}`}>{loading?'Loading network…':saveStatus==='saving'?'Saving to Atlas…':saveStatus==='saved'?'Saved to MongoDB Atlas':saveStatus==='error'?'Save failed':'MongoDB Atlas'}</div></div>
      <div className="network-strength-guide"><b>Connection strength</b><span>1 Cold</span><span>2 Email / social reply</span><span>3 Text reply</span><span>4 Call</span><span>5 In person</span></div>
      {error&&<div className="network-error" role="alert"><span>{error}</span><button onClick={onRetry}>Try again</button></div>}
    </section>

    <section className="network-map-card">
      <div className="network-map-heading"><div><p className="eyebrow">CONNECTION PATHS</p><h2>{selectedTarget?`How you connect to ${selectedTarget.name}`:'Choose a connection'}</h2></div><label className="network-target-picker"><span>Explore</span><select value={targetId} onChange={event=>setTargetId(event.target.value)} disabled={!nodes.length}>{nodes.filter(node=>node.id!=='you').map(node=><option key={node.id} value={node.id}>{node.name}</option>)}</select></label></div>
      {loading&&!graph?<div className="network-empty">Loading your connection graph…</div>:!paths.length?<div className="network-empty"><NetworkIcon size={22}/><span>No confirmed route yet. Add people and relationship details below to build one.</span></div>:<div className="network-tree-scroll"><div className="network-converging-tree" style={{gridTemplateRows:`repeat(${paths.length}, minmax(78px, auto))`}}>
        <div className="network-converging-endpoint source" style={{gridRow:`1 / span ${paths.length}`}}><NetworkNodePill node={youNode}/></div>
        {paths.map((path,index)=>{
          const intermediates=path.nodes.slice(1,-1);
          return <div className={`network-converging-route ${path.potential?'potential':''}`} style={{gridRow:index+1}} key={path.edges.map(edge=>edge.id).join(':')||targetId}>
            <span className="network-route-number">{path.potential?'Potential':'Path'} {index+1}</span>
            {intermediates.length?intermediates.map((node,nodeIndex)=><React.Fragment key={`${node.id}-${nodeIndex}`}>
              <div className="network-route-step"><small className={path.edges[nodeIndex]?.status==='potential'?'potential':''}>{path.edges[nodeIndex]?.label}</small><NetworkNodePill node={node}/></div><span className="network-flow-arrow" aria-hidden="true">→</span>
            </React.Fragment>):<small className={`network-route-direct-label ${path.edges[0]?.status==='potential'?'potential':''}`}>{path.edges[0]?.label||'Direct connection'}</small>}
            {intermediates.length>0&&<small className={`network-route-target-label ${path.edges.at(-1)?.status==='potential'?'potential':''}`}>{path.edges.at(-1)?.label}</small>}
          </div>;
        })}
        <div className="network-converging-endpoint target" style={{gridRow:`1 / span ${paths.length}`}}><NetworkNodePill node={selectedTarget}/></div>
      </div></div>}
      {!!paths.length&&<div className="network-path-count"><GitBranch size={13}/>{paths.length} {paths.length===1?'route':'routes'} shown in one tree{paths.some(path=>path.potential)&&<span> · potential branches included</span>}</div>}
      <p className="network-map-note">The map starts at one You node and merges every route at one target. Strength rates your direct relationship with a person; unrated contacts stay blank until you set them.</p>
    </section>

    <section className="network-editor-grid">
      <form className="network-editor-card" onSubmit={addNode}>
        <div className="network-editor-heading"><span className="network-editor-icon"><Plus size={15}/></span><div><h2>Add a connection</h2><p>Add a person or organization to your network.</p></div></div>
        <label className="network-field"><span>Name</span><input maxLength={120} value={newName} onChange={event=>setNewName(event.target.value)} placeholder="Person or organization" required/></label>
        <label className="network-field"><span>Type</span><select value={newType} onChange={event=>setNewType(event.target.value)}><option value="person">Person</option><option value="organization">Organization / platform</option></select></label>
        <button className="network-primary-button" type="submit" disabled={!newName.trim()}>Add to network</button>
      </form>
      <form className="network-editor-card" onSubmit={addEdge}>
        <div className="network-editor-heading"><span className="network-editor-icon"><GitBranch size={15}/></span><div><h2>Describe a relationship</h2><p>Add a link that creates or extends a path.</p></div></div>
        <label className="network-field"><span>From</span><select value={edgeFrom} onChange={event=>setEdgeFrom(event.target.value)}>{nodes.map(node=><option key={node.id} value={node.id}>{node.name}</option>)}</select></label>
        <label className="network-field"><span>Connected to</span><select value={edgeTo} onChange={event=>setEdgeTo(event.target.value)}>{nodes.filter(node=>node.id!==edgeFrom).map(node=><option key={node.id} value={node.id}>{node.name}</option>)}</select></label>
        <label className="network-field"><span>How are they connected?</span><input maxLength={240} value={edgeLabel} onChange={event=>setEdgeLabel(event.target.value)} placeholder="e.g. manages, collaborated with" required/></label>
        <label className="network-field"><span>Path status</span><select value={edgeStatus} onChange={event=>setEdgeStatus(event.target.value)}><option value="confirmed">Known connection</option><option value="potential">Potential lead</option></select></label>
        <button className="network-primary-button" type="submit" disabled={!edgeFrom||!edgeTo||edgeFrom===edgeTo||!edgeLabel.trim()}>Add relationship</button>
      </form>
    </section>

    <details className="network-strength-editor">
      <summary>Edit direct connection strengths <span>{people.length} people</span></summary>
      <div className="network-strength-list">{people.map(person=><label key={person.id} className="network-strength-row"><span><UserRound size={14}/><b>{person.name}</b></span><select aria-label={`Connection strength for ${person.name}`} value={person.strength??''} onChange={event=>onStrengthChange(person.id,event.target.value?Number(event.target.value):null)}><option value="">Unrated</option>{STRENGTH_LABELS.map((label,index)=><option key={index+1} value={index+1}>{label}</option>)}</select></label>)}</div>
    </details>
  </main>;
}
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
  const [activeView, setActiveView] = useState('time');
  const [financeDatabase, setFinanceDatabase] = useState(null);
  const [financeTransactions, setFinanceTransactions] = useState([]);
  const [financeInputs, setFinanceInputs] = useState({});
  const [financeStorageStatus, setFinanceStorageStatus] = useState('loading');
  const [financeStorageError, setFinanceStorageError] = useState('');
  const [financeDirty, setFinanceDirty] = useState(false);
  const financeEditSequence = useRef(0);
  const [financeAnnotations, setFinanceAnnotations] = useState({expenseCategories:{},expenseBudgets:{}});
  const [financeAnnotationStatus, setFinanceAnnotationStatus] = useState('loading');
  const [financeAnnotationError, setFinanceAnnotationError] = useState('');
  const [financeAnnotationsDirty, setFinanceAnnotationsDirty] = useState(false);
  const financeAnnotationSequence = useRef(0);
  const [financeBusy, setFinanceBusy] = useState(false);
  const [financeError, setFinanceError] = useState('');
  const [networkGraph, setNetworkGraph] = useState(null);
  const [networkBusy, setNetworkBusy] = useState(false);
  const [networkLoadAttempted, setNetworkLoadAttempted] = useState(false);
  const [networkError, setNetworkError] = useState('');
  const [networkSaveStatus, setNetworkSaveStatus] = useState('ready');
  const [networkDirty, setNetworkDirty] = useState(false);
  const networkEditSequence = useRef(0);

  const loadNotion = useCallback(async () => {
    setNotionError('');
    try {
      const [db, pageData] = await Promise.all([api('/api/notion/database'), api('/api/notion/pages')]);
      console.log('[Weekview] Notion database schema:', db.properties);
      console.log('[Weekview] Notion habit rows received:', pageData.results || []);
      setDatabase(db); setHabitRows(pageData.results || []);
    } catch (error) { setNotionError(error.message); }
  }, []);

  const loadFinanceDatabase = useCallback(async () => {
    if (financeDatabase || financeBusy) return;
    setFinanceBusy(true);
    setFinanceError('');
    setFinanceStorageStatus('loading');
    setFinanceAnnotationStatus('loading');
    const editSequenceAtLoad = financeEditSequence.current;
    const annotationSequenceAtLoad = financeAnnotationSequence.current;
    try {
      const params = new URLSearchParams({ databaseId: FINANCE_DATABASE_ID, viewId: FINANCE_VIEW_ID });
      const [data, pageData, savedInputs, savedAnnotations] = await Promise.all([
        api(`/api/notion/finance/database?${params.toString()}`),
        api(`/api/notion/finance/pages?${params.toString()}`),
        api('/api/finance/inputs').catch(error => ({ storageError: error.message })),
        api('/api/finance/annotations').catch(error => ({ storageError: error.message }))
      ]);
      setFinanceDatabase(data);
      setFinanceTransactions(pageData.results || []);
      if (savedInputs.storageError) {
        setFinanceStorageStatus('unavailable');
        setFinanceStorageError(savedInputs.storageError);
      } else {
        if (financeEditSequence.current === editSequenceAtLoad) setFinanceInputs(savedInputs.inputs || {});
        setFinanceStorageStatus('ready');
        setFinanceStorageError('');
      }
      if (savedAnnotations.storageError) {
        setFinanceAnnotationStatus('error');
        setFinanceAnnotationError(savedAnnotations.storageError);
      } else {
        if (financeAnnotationSequence.current===annotationSequenceAtLoad) setFinanceAnnotations(savedAnnotations.annotations||{expenseCategories:{},expenseBudgets:{}});
        setFinanceAnnotationStatus('ready');
        setFinanceAnnotationError('');
      }
    } catch (error) {
      setFinanceError(error.message);
    } finally {
      setFinanceBusy(false);
    }
  }, [financeDatabase, financeBusy]);
  const setFinanceInput = useCallback((key, value) => {
    financeEditSequence.current += 1;
    setFinanceDirty(true);
    setFinanceStorageStatus(current => current === 'error' ? 'ready' : current);
    setFinanceInputs(current => ({...current,[key]:value}));
  }, []);

  const changeFinanceAnnotations = useCallback(transform => {
    financeAnnotationSequence.current += 1;
    setFinanceAnnotationsDirty(true);
    setFinanceAnnotationStatus('ready');
    setFinanceAnnotationError('');
    setFinanceAnnotations(current=>transform(current));
  }, []);
  const setExpenseCategory = useCallback((pageId,category) => changeFinanceAnnotations(current=>({
    ...current,expenseCategories:{...current.expenseCategories,[pageId]:category}
  })),[changeFinanceAnnotations]);
  const setExpenseBudget = useCallback((category,amount) => changeFinanceAnnotations(current=>({
    ...current,expenseBudgets:{...current.expenseBudgets,[category]:amount}
  })),[changeFinanceAnnotations]);

  const loadNetworkGraph = useCallback(async () => {
    if (networkBusy) return;
    setNetworkBusy(true);
    setNetworkLoadAttempted(true);
    setNetworkError('');
    try {
      const data = await api('/api/network/graph');
      setNetworkGraph(data.graph);
      setNetworkSaveStatus('ready');
      setNetworkDirty(false);
    } catch (error) {
      setNetworkError(error.message);
      setNetworkSaveStatus('error');
    } finally { setNetworkBusy(false); }
  }, [networkBusy]);

  const changeNetworkGraph = useCallback(transform => {
    networkEditSequence.current += 1;
    setNetworkDirty(true);
    setNetworkSaveStatus('ready');
    setNetworkGraph(current => current ? transform(current) : current);
  }, []);
  const addNetworkNode = useCallback(node => {
    changeNetworkGraph(graph => ({...graph,nodes:[...graph.nodes,node]}));
  }, [changeNetworkGraph]);
  const addNetworkEdge = useCallback(edge => {
    changeNetworkGraph(graph => ({...graph,edges:[...graph.edges,edge]}));
  }, [changeNetworkGraph]);
  const setNetworkStrength = useCallback((nodeId,strength) => {
    changeNetworkGraph(graph => ({...graph,nodes:graph.nodes.map(node=>node.id===nodeId?{...node,strength}:node)}));
  }, [changeNetworkGraph]);

  useEffect(() => {
    if (activeView==='network'&&!networkGraph&&!networkBusy&&!networkLoadAttempted) loadNetworkGraph();
  }, [activeView,networkGraph,networkBusy,networkLoadAttempted,loadNetworkGraph]);

  useEffect(() => {
    if (activeView!=='network'||networkSaveStatus!=='ready'||!networkDirty||!networkGraph) return undefined;
    const saveSequence=networkEditSequence.current;
    const timer=setTimeout(async()=>{
      setNetworkSaveStatus('saving');
      try {
        await api('/api/network/graph',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({graph:networkGraph})});
        if(networkEditSequence.current===saveSequence){setNetworkDirty(false);setNetworkSaveStatus('saved');setNetworkError('');}
        else setNetworkSaveStatus('ready');
      } catch(error){setNetworkSaveStatus('error');setNetworkError(error.message);}
    },600);
    return ()=>clearTimeout(timer);
  },[activeView,networkDirty,networkGraph,networkSaveStatus]);

  useEffect(() => {
    if (activeView !== 'finance' || financeStorageStatus !== 'ready' || !financeDirty) return undefined;
    const saveSequence = financeEditSequence.current;
    const timer = setTimeout(async () => {
      setFinanceStorageStatus('saving');
      try {
        await api('/api/finance/inputs', {
          method: 'PUT', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ inputs: financeInputs })
        });
        if (financeEditSequence.current === saveSequence) {
          setFinanceDirty(false);
          setFinanceStorageStatus('saved');
          setFinanceStorageError('');
        } else setFinanceStorageStatus('ready');
      } catch (error) {
        setFinanceStorageStatus('error');
        setFinanceStorageError(error.message);
      }
    }, 500);
    return () => clearTimeout(timer);
  }, [activeView, financeDirty, financeInputs, financeStorageStatus]);

  useEffect(() => {
    if (activeView!=='finance'||financeAnnotationStatus!=='ready'||!financeAnnotationsDirty) return undefined;
    const saveSequence=financeAnnotationSequence.current;
    const timer=setTimeout(async()=>{
      setFinanceAnnotationStatus('saving');
      try {
        await api('/api/finance/annotations',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({annotations:financeAnnotations})});
        if(financeAnnotationSequence.current===saveSequence){setFinanceAnnotationsDirty(false);setFinanceAnnotationStatus('saved');setFinanceAnnotationError('');}
        else setFinanceAnnotationStatus('ready');
      } catch(error){setFinanceAnnotationStatus('error');setFinanceAnnotationError(error.message);}
    },500);
    return ()=>clearTimeout(timer);
  },[activeView,financeAnnotationStatus,financeAnnotations,financeAnnotationsDirty]);

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

  useEffect(() => {
    if (activeView === 'finance' && !financeDatabase && !financeBusy) loadFinanceDatabase();
  }, [activeView]);

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
  const streakRecord = recordByDate.size ? [...recordByDate.values()].at(-1) : 0;
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
      <nav className="view-tabs" aria-label="Weekview sections">
        <button className={`view-tab ${activeView==='time'?'active':''}`} aria-pressed={activeView==='time'} onClick={()=>setActiveView('time')}>Time</button>
        <button className={`view-tab ${activeView==='finance'?'active':''}`} aria-pressed={activeView==='finance'} onClick={()=>setActiveView('finance')}>Finance</button>
        <button className={`view-tab ${activeView==='network'?'active':''}`} aria-pressed={activeView==='network'} onClick={()=>setActiveView('network')}>Network</button>
      </nav>
      <div className="topbar-actions">
        <span className="account-label">{auth.email || 'Google connected'}</span>
        <button className="icon-button" title="Refresh all data" onClick={()=>{loadWeek({force:true});loadNotion();}}><RefreshCw size={15}/></button>
        <button className="signout" onClick={signOut}><LogOut size={14}/> Sign out</button>
      </div>
    </header>

    {activeView === 'time' ? <main className="dashboard">
      <aside className="sidebar">
        <div className="streak-summary-card">
          <div><p className="eyebrow">ALL HABITS</p><h2>Streak</h2></div>
          <div className="streak-summary-values"><div><strong>{currentStreak.count}</strong><span>Current days</span></div><div><strong>{streakRecord}</strong><span>Record</span></div></div>
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
    </main> : activeView==='finance' ? <FinancePage database={financeDatabase} transactions={financeTransactions} loading={financeBusy} error={financeError} onRetry={loadFinanceDatabase} inputs={financeInputs} onInput={setFinanceInput} storageStatus={financeStorageStatus} storageError={financeStorageError} annotations={financeAnnotations} annotationStatus={financeAnnotationStatus} annotationError={financeAnnotationError} onExpenseCategory={setExpenseCategory} onExpenseBudget={setExpenseBudget}/> : <NetworkPage graph={networkGraph} loading={networkBusy} error={networkError} onRetry={loadNetworkGraph} onAddNode={addNetworkNode} onAddEdge={addNetworkEdge} onStrengthChange={setNetworkStrength} saveStatus={networkSaveStatus}/>}
  </div>;
}

createRoot(document.getElementById('root')).render(<React.StrictMode><App/></React.StrictMode>);
