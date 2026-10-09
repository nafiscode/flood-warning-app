/**
 * The one script that runs before the page is painted, so the app is already the right colour
 * when it appears instead of flashing white at night (the owner's note, 9 Oct).
 *
 * It is written out by hand because nothing can be imported this early. That is a copy of the
 * sunrise equation in lib/sun.ts, so tests/unit/theme.test.ts runs both over a year of moments
 * and fails if they ever disagree.
 *
 * It reads the area the person chose from the phone's own storage; nothing is asked of the
 * network, no position is requested, and nothing leaves the phone.
 */
export const DAYLIGHT_SCRIPT = `(function(){try{
var lat=6.8,lon=101.2;
try{var a=JSON.parse(localStorage.getItem("jaga.area")||"null");
if(a&&typeof a.lat==="number"&&typeof a.lon==="number"){lat=a.lat;lon=a.lon}}catch(e){}
var now=Date.now(),R=Math.PI/180,jd=now/86400000+2440587.5,lw=-lon;
var n=Math.round(jd-2451545.0009-lw/360),j=2451545.0009+lw/360+n;
var m=(357.5291+0.98560028*(j-2451545))%360;
var c=1.9148*Math.sin(m*R)+0.02*Math.sin(2*m*R)+0.0003*Math.sin(3*m*R);
var l=(m+c+180+102.9372)%360;
var t=j+0.0053*Math.sin(m*R)-0.0069*Math.sin(2*l*R);
var sd=Math.sin(l*R)*Math.sin(23.44*R),cd=Math.cos(Math.asin(sd));
var ch=(Math.sin(-0.833*R)-Math.sin(lat*R)*sd)/(Math.cos(lat*R)*cd);
var night;
if(ch>1||ch<-1){var h=new Date(now).getHours();night=h<6||h>=18}
else{var w=Math.acos(ch)/R,ms=function(x){return (x-2440587.5)*86400000};
night=now<ms(t-w/360)||now>=ms(t+w/360)}
document.documentElement.dataset.theme=night?"dark":"light";
}catch(e){}})();`;
