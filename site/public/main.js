(function(){
var r=document.documentElement;
function get(){try{return localStorage.getItem('theme')}catch(e){return null}}
function set(v){try{localStorage.setItem('theme',v)}catch(e){}}
var b=document.getElementById('theme');
if(b)b.addEventListener('click',function(){
  var cur=r.getAttribute('data-theme')||(matchMedia('(prefers-color-scheme: light)').matches?'light':'dark');
  var n=cur==='dark'?'light':'dark';r.setAttribute('data-theme',n);set(n);
});
document.querySelectorAll('.copy').forEach(function(btn){
  btn.addEventListener('click',function(){
    var t=document.getElementById(btn.dataset.target).innerText.trim(),old=btn.textContent;
    var done=function(m){btn.textContent=m;setTimeout(function(){btn.textContent=old},1600)};
    if(navigator.clipboard&&navigator.clipboard.writeText){navigator.clipboard.writeText(t).then(function(){done('Copied')},function(){done('Press Ctrl+C')})}
    else done('Select and copy');
  });
});
var els=document.querySelectorAll('.rv');
if(!('IntersectionObserver' in window)||matchMedia('(prefers-reduced-motion: reduce)').matches){els.forEach(function(e){e.classList.add('in')});return}
var io=new IntersectionObserver(function(es){es.forEach(function(e){if(e.isIntersecting){e.target.classList.add('in');io.unobserve(e.target)}})},{threshold:.12});
els.forEach(function(e,i){e.style.transitionDelay=(i%3)*70+'ms';io.observe(e)});
})();
