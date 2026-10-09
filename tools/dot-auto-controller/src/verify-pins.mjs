import {loadCatalog} from './catalog.mjs';
import fs from 'node:fs';
import {verifyPins} from './native-bindings.mjs';
const catalog=loadCatalog();
const sources=Object.fromEntries(Object.entries(catalog.sources).map(([key,route])=>[key,{...(route.configured?verifyPins(route):{checked:0,qualification:'NOT_CONFIGURED'}),enabled:route.enabled,route:route.route,candidateVersion:route.candidate?.version??null}]));
console.log(JSON.stringify({status:'OFFLINE_PINS_VERIFIED',sources,liveActivated:false}));
