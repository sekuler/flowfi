// Deck navigation. Kept in its own file so the site's Content Security Policy (no inline scripts) allows it.
const slides = document.querySelectorAll('.slide');
const progress = document.getElementById('progress');
const counter = document.getElementById('counter');
let current = 0;

slides.forEach((s,i)=>{
  const seg = document.createElement('div');
  seg.className = 'seg';
  seg.onclick = ()=> setSlide(i);
  progress.appendChild(seg);
});

function render(){
  slides.forEach((s,i)=> s.classList.toggle('active', i===current));
  document.querySelectorAll('.seg').forEach((seg,i)=>{
    seg.classList.remove('done','now');
    if(i < current) seg.classList.add('done');
    if(i === current) seg.classList.add('now');
  });
  counter.textContent = (current+1)+' / '+slides.length;
  document.getElementById('prevBtn').disabled = current===0;
  document.getElementById('nextBtn').disabled = current===slides.length-1;
}
function setSlide(i){ current = Math.max(0, Math.min(slides.length-1, i)); render(); }
function go(delta){ setSlide(current+delta); }

document.addEventListener('keydown', (e)=>{
  if(e.key === 'ArrowRight' || e.key === ' ') go(1);
  if(e.key === 'ArrowLeft') go(-1);
});

document.getElementById('prevBtn').addEventListener('click', ()=> go(-1));
document.getElementById('nextBtn').addEventListener('click', ()=> go(1));

render();
