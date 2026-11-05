let installPrompt=null,registration=null;
export function installed(){return matchMedia('(display-mode: standalone)').matches||matchMedia('(display-mode: fullscreen)').matches||navigator.standalone===true;}
window.addEventListener('beforeinstallprompt',event=>{event.preventDefault();installPrompt=event;window.dispatchEvent(new Event('install-ready'));});
window.addEventListener('appinstalled',()=>{installPrompt=null;window.dispatchEvent(new Event('install-ready'));});
export async function installApp(){if(!installPrompt)return false;const prompt=installPrompt;installPrompt=null;await prompt.prompt();await prompt.userChoice;return true;}
export function canInstall(){return !!installPrompt;}
export async function registerApp(){
  if(!('serviceWorker' in navigator))return null;
  registration=await navigator.serviceWorker.register('/sw.js',{updateViaCache:'none'});
  const notify=()=>{if(registration.waiting)window.dispatchEvent(new Event('app-update'));};notify();
  registration.addEventListener('updatefound',()=>registration.installing?.addEventListener('statechange',notify));
  return registration;
}
export function hasUpdate(){return !!registration?.waiting;}
export function updateApp(){if(!registration?.waiting)return; navigator.serviceWorker.addEventListener('controllerchange',()=>location.reload(),{once:true});registration.waiting.postMessage({type:'ACTIVATE_UPDATE'});}
export async function fullscreen(){if(document.fullscreenElement)return document.exitFullscreen();if(document.documentElement.requestFullscreen)return document.documentElement.requestFullscreen();throw Error('Fullscreen isn’t supported here. Install Readbook to hide the browser toolbar.');}

export async function ensureOffline(){
  if(!('serviceWorker' in navigator))throw Error('Offline reading needs HTTPS and a browser with service-worker support.');
  await registerApp();
  let timer;
  try{await Promise.race([navigator.serviceWorker.ready,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('The offline app is still preparing. Try again shortly.')),15000);})]);}
  finally{clearTimeout(timer);}
}
