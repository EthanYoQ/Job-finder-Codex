/** Exact source bytes used by local prospective replay and the current service. */
export function combinedReaderPins(readerPins,apiPins){
 const result={};
 for(const role of ['main','fallback']){
  const api=apiPins?.[role],native=readerPins?.[role]?.readerFileHashes;
  if(!native||Object.keys(native).length!==16||!api)throw Error('LOCAL_READER_PINS_REQUIRED');
  const hashes={...native,'src/server/portablePublicationApi.ts':api.apiSha256,'src/server/publicApi.ts':api.handlerSha256,'src/domain/jobLocation.ts':api.locationSha256};
  if(Object.keys(hashes).length!==19||Object.values(hashes).some(v=>typeof v!=='string'||!/^[a-f0-9]{64}$/.test(v)))throw Error('LOCAL_READER_PIN_SHAPE');
  result[role]=Object.freeze(hashes);
 }
 return Object.freeze(result);
}
