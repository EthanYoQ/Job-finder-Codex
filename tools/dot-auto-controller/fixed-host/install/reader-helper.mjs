/** Original current reader proof, fixed native pins; no database connection.
 * Invoked only by the EX holder after original staged-source verification.
 */
import fs from 'node:fs';
import {pathToFileURL} from 'node:url';
const input=JSON.parse(fs.readFileSync(0,'utf8'));
const {createControlPlane}=await import(pathToFileURL(input.packageRoot+'/src/control-plane.mjs'));
const {combinedReaderPins}=await import(pathToFileURL(input.packageRoot+'/src/reader-pin-binding.mjs'));
const native=JSON.parse(fs.readFileSync(input.packageRoot+'/config/reader-pins.json','utf8'));
const api=JSON.parse(fs.readFileSync(input.packageRoot+'/config/reader-api-pins.json','utf8'));
const readerFilePins=combinedReaderPins(native,api);
const plane=createControlPlane({readerFilePins,openConnection(){throw Error('INSTALL_READER_DATABASE_FORBIDDEN');}});
const identity=await plane.readerIdentity(input.expected);
process.stdout.write(JSON.stringify(identity)+'\n');
