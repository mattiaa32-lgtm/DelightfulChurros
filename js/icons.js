/* =================== service marks ==================================
   Simplified glyphs for the three services the app links out to, drawn
   in the same line/solid style as the rest of the UI so they sit
   consistently next to the app's own icons. Each is a recognisable
   shape at 16px rather than a pixel-exact reproduction of the brand
   artwork \u2014 they identify the destination of a link, which is what a
   link icon is for.

   Brand colours are used on request via svcIcon(name, true); the muted
   variant inherits currentColor and suits a dense row of links. */
var SVC_COLORS={spotify:"#1DB954",youtube:"#FF0033",discogs:"#EDEAE3"};

function svcIcon(name,brand,size){
  var s=size||15,col=brand?(SVC_COLORS[name]||"currentColor"):"currentColor";
  var open="<svg class='svci' viewBox='0 0 24 24' width='"+s+"' height='"+s+
           "' aria-hidden='true' focusable='false'>";
  if(name==="spotify"){
    /* filled disc with three sweeping bars */
    return open+
      "<circle cx='12' cy='12' r='11' fill='"+col+"'></circle>"+
      "<g fill='none' stroke='#0B0A09' stroke-width='1.9' stroke-linecap='round'>"+
        "<path d='M6.7 8.6c3.4-1 7.5-.7 10.5 1.1'></path>"+
        "<path d='M7.4 12c2.8-.8 6.2-.5 8.7 1'></path>"+
        "<path d='M8.1 15.3c2.3-.6 4.9-.4 6.9.8'></path>"+
      "</g></svg>";
  }
  if(name==="youtube"){
    /* rounded screen with a play triangle knocked out */
    return open+
      "<rect x='1.5' y='4.5' width='21' height='15' rx='4.4' fill='"+col+"'></rect>"+
      "<polygon points='10,8.7 16,12 10,15.3' fill='#0B0A09'></polygon>"+
      "</svg>";
  }
  /* discogs: a record \u2014 outer ring, groove, spindle */
  return open+
    "<circle cx='12' cy='12' r='10.4' fill='none' stroke='"+col+"' stroke-width='1.8'></circle>"+
    "<circle cx='12' cy='12' r='5.6' fill='none' stroke='"+col+"' stroke-width='1.4' opacity='.65'></circle>"+
    "<circle cx='12' cy='12' r='1.7' fill='"+col+"'></circle>"+
    "</svg>";
}
