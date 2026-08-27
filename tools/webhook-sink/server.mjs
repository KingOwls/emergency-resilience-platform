import http from 'node:http';
const events=[];
const server=http.createServer(async(req,res)=>{
  if(req.method==='GET'&&req.url==='/health'){res.writeHead(200,{'content-type':'application/json'});return res.end(JSON.stringify({status:'ready'}));}
  if(req.method==='GET'&&req.url==='/events'){res.writeHead(200,{'content-type':'application/json'});return res.end(JSON.stringify({events}));}
  if(req.method==='POST'&&req.url==='/hook'){
    const chunks=[];for await(const c of req)chunks.push(c);
    let body={};try{body=JSON.parse(Buffer.concat(chunks).toString('utf8'))}catch{}
    events.push({received_at:new Date().toISOString(),body});
    res.writeHead(202,{'content-type':'application/json'});return res.end(JSON.stringify({accepted:true}));
  }
  res.writeHead(404);res.end();
});
server.listen(3200,'0.0.0.0');
