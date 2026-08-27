const KEY='rescue-v2-offline-queue';
export function readQueue(){ try{return JSON.parse(localStorage.getItem(KEY)||'[]')}catch{return[]} }
export function enqueue(item){ const q=readQueue(); q.push(item); localStorage.setItem(KEY,JSON.stringify(q)); return q.length; }
export function replaceQueue(q){ localStorage.setItem(KEY,JSON.stringify(q)); }
