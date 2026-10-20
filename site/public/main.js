(function(){
var r=document.documentElement;
function get(){try{return localStorage.getItem('theme')}catch(e){return null}}
function set(v){try{localStorage.setItem('theme',v)}catch(e){}}
var b=document.getElementById('theme');
if(b)b.addEventListener('click',function(){
  var cur=r.getAttribute('data-theme')||(matchMedia('(prefers-color-scheme: light)').matches?'light':'dark');
  var n=cur==='dark'?'light':'dark';r.setAttribute('data-theme',n);set(n);
});
document.querySelectorAll('.copy[data-target]').forEach(function(btn){
  btn.addEventListener('click',function(){
    var t=document.getElementById(btn.dataset.target).innerText.trim(),old=btn.textContent;
    var done=function(m){btn.textContent=m;setTimeout(function(){btn.textContent=old},1600)};
    if(navigator.clipboard&&navigator.clipboard.writeText){navigator.clipboard.writeText(t).then(function(){done('Copied')},function(){done('Press Ctrl+C')})}
    else done('Select and copy');
  });
});

var rm=matchMedia('(prefers-reduced-motion: reduce)').matches;
var fine=matchMedia('(hover: hover) and (pointer: fine)').matches;
var $=function(s,c){return(c||document).querySelector(s)};

/* simulation widget (works with and without motion) */
(function(){
  var send=$('#simsend');if(!send)return;
  var N=5,left=N,fill=$('#simfill'),track=$('#simtrack'),txt=$('#simleft'),last=$('#simlast'),chips=$('#simchips');
  function paint(){
    fill.style.transform='scaleX('+left/N+')';track.classList.toggle('empty',left===0);
    track.setAttribute('aria-valuenow',left);txt.textContent=left+' of '+N+' remaining';
  }
  send.addEventListener('click',function(){
    var ok=left>0,b=document.createElement('b');
    if(ok)left--;
    last.innerHTML=ok?'Last response: <span class="ok">200 OK</span><br>X-RateLimit-Remaining: '+left
      :'Last response: <span class="no">429 Too Many Requests</span><br>Retry-After and X-RateLimit-Remaining: 0';
    b.textContent=ok?'200':'429';if(!ok)b.className='x';chips.appendChild(b);
    while(chips.children.length>6)chips.removeChild(chips.firstChild);
    paint();
  });
  $('#simreset').addEventListener('click',function(){left=N;chips.textContent='';last.textContent='Last response: none yet';paint()});
})();

/* header, progress, active nav */
(function(){
  var hd=$('header.top'),bar=$('.prog'),tick=false;
  function upd(){
    tick=false;var y=scrollY,max=document.documentElement.scrollHeight-innerHeight;
    hd.classList.toggle('scrolled',y>8);
    if(bar)bar.style.transform='scaleX('+(max>0?Math.min(1,y/max):0)+')';
  }
  addEventListener('scroll',function(){if(!tick){tick=true;requestAnimationFrame(upd)}},{passive:true});
  addEventListener('resize',upd);upd();
  if(!('IntersectionObserver' in window))return;
  var links={};document.querySelectorAll('nav.links a[href^="#"]').forEach(function(a){links[a.getAttribute('href').slice(1)]=a});
  var so=new IntersectionObserver(function(es){es.forEach(function(e){
    var a=links[e.target.id];if(!a)return;
    if(e.isIntersecting){Object.keys(links).forEach(function(k){links[k].removeAttribute('aria-current')});a.setAttribute('aria-current','true')}
    else a.removeAttribute('aria-current');
  })},{rootMargin:'-40% 0px -55% 0px'});
  Object.keys(links).forEach(function(k){var s=document.getElementById(k);if(s)so.observe(s)});
})();

/* reveals */
var els=document.querySelectorAll('.rv');
var hero=$('.hero');
function settle(e,ms){setTimeout(function(){e.style.transitionDelay='';e.classList.add('done')},ms+800)}
if(!('IntersectionObserver' in window)||rm){els.forEach(function(e){e.classList.add('in','done')})}
else{
  var io=new IntersectionObserver(function(es){es.forEach(function(e){if(e.isIntersecting){e.target.classList.add('in');io.unobserve(e.target)}})},{threshold:.12});
  var hi=0;
  els.forEach(function(e,i){
    var d=hero.contains(e)?(hi++,380+hi*110):(i%3)*70;
    e.style.transitionDelay=d+'ms';settle(e,d);io.observe(e);
  });
}

/* hero headline: word reveal */
(function(){
  var h=$('h1');if(!h||rm||!r.classList.contains('anim'))return;
  var i=0,kids=Array.prototype.slice.call(h.childNodes);
  kids.forEach(function(nd){
    if(nd.nodeType===3){
      var f=document.createDocumentFragment();
      nd.textContent.split(/(\s+)/).forEach(function(p){
        if(!p)return;if(/^\s+$/.test(p)){f.appendChild(document.createTextNode(' '));return}
        var s=document.createElement('span');s.className='wd';s.style.setProperty('--d',60+i++*90);s.textContent=p;f.appendChild(s);
      });
      h.replaceChild(f,nd);
    }else if(nd.nodeType===1){nd.classList.add('wd');nd.style.setProperty('--d',60+i++*90+140)}
  });
  h.classList.add('hs');
  requestAnimationFrame(function(){requestAnimationFrame(function(){h.classList.add('go')})});
})();

/* terminal: typed session, plays once in view; Replay restarts it */
(function(){
  var code=$('#term'),rb=$('#replay');if(!code||!rb||rm)return;
  rb.hidden=false;
  var lines=Array.prototype.slice.call(code.querySelectorAll('.ln')),tys=code.querySelectorAll('.ty'),
      full=Array.prototype.map.call(tys,function(t){return t.textContent}),run=0;
  function restore(){tys.forEach(function(t,k){t.textContent=full[k];t.classList.remove('typing')})}
  function reset(){code.classList.add('term-on');lines.forEach(function(l){l.classList.remove('on')});restore()}
  function done(){code.classList.remove('term-on');code.removeAttribute('aria-busy');restore()}
  function wait(ms){return new Promise(function(res){setTimeout(res,ms)})}
  async function play(){
    var id=++run;reset();code.setAttribute('aria-busy','true');await wait(250);
    for(var i=0;i<lines.length;i++){
      if(id!==run)return;
      var l=lines[i],t=l.querySelector('.ty');
      if(t){
        var s=t.textContent;t.textContent='';t.classList.add('typing');l.classList.add('on');
        for(var c=1;c<=s.length;c++){await wait(s.length>40?9:22);if(id!==run)return;t.textContent=s.slice(0,c)}
        t.classList.remove('typing');await wait(380);
      }else{l.classList.add('on');await wait(l.classList.contains('c')?40:110)}
    }
    if(id===run)done();
  }
  rb.addEventListener('click',play);
  if(!('IntersectionObserver' in window))return;
  reset();
  var to=new IntersectionObserver(function(es){if(es[0].isIntersecting){to.disconnect();play()}},{threshold:.4});
  to.observe(code.closest('.code'));
})();

/* pointer effects (fine pointers only) */
if(fine&&!rm){
  var sp=document.createElement('div');sp.className='spot';sp.setAttribute('aria-hidden','true');hero.appendChild(sp);
  hero.addEventListener('pointermove',function(e){var q=hero.getBoundingClientRect();sp.style.transform='translate3d('+(e.clientX-q.left)+'px,'+(e.clientY-q.top)+'px,0)';sp.classList.add('on')});
  hero.addEventListener('pointerleave',function(){sp.classList.remove('on')});
  document.querySelectorAll('.card').forEach(function(c){
    c.classList.add('glow');
    c.addEventListener('pointermove',function(e){var q=c.getBoundingClientRect();c.style.setProperty('--mx',e.clientX-q.left+'px');c.style.setProperty('--my',e.clientY-q.top+'px')});
  });
  var m=$('.btn.primary');
  if(m){
    m.classList.add('mag');
    m.addEventListener('pointermove',function(e){var q=m.getBoundingClientRect();
      m.style.setProperty('--tx',(e.clientX-q.left-q.width/2)*.22+'px');m.style.setProperty('--ty',(e.clientY-q.top-q.height/2)*.3+'px')});
    m.addEventListener('pointerleave',function(){m.style.removeProperty('--tx');m.style.removeProperty('--ty')});
  }
}
})();
