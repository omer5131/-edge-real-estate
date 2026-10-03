import test from 'node:test';
import assert from 'node:assert/strict';
import {parseYad2Html,normalizeListing} from '../.server-test/server/sources/yad2Source.js';
const url='https://www.yad2.co.il/realestate/item/coastal-north/location1';
const detail=address=>'<script id="__NEXT_DATA__">'+JSON.stringify({props:{pageProps:{dehydratedState:{queries:[{queryKey:['item','location1'],state:{data:{token:'location1',address}}}]}}}})+'</script>';
test('Yad2 map points retain source coordinates and conservative approximate accuracy',()=>{
 const raw=parseYad2Html(detail({coords:{lat:32.8,lon:34.98},house:{number:16}}),url,false);
 const {data}=normalizeListing(raw);
 assert.equal(data.latitude,32.8);assert.equal(data.longitude,34.98);
 assert.equal(data.location_source,'yad2');assert.equal(data.location_accuracy,'approximate');
 assert.equal(data.location_precision_m,null);
 assert.equal(data.location_metadata.accuracy_basis,'conservative_default');
 assert.deepEqual(data.location_metadata.source_coordinates,{lat:32.8,lon:34.98});
});
test('missing map coordinates stay missing even when an address is present',()=>{
 const {data}=normalizeListing(parseYad2Html(detail({street:{text:'Test'},house:{number:16}}),url,false));
 for(const key of ['latitude','longitude','location_source','location_accuracy','location_precision_m','location_metadata'])assert.equal(data[key],null);
});
test('coordinate ranges and provenance are validated without upgrading geocoded accuracy',()=>{
 assert.throws(()=>normalizeListing({url,latitude:91,longitude:34}),/latitude/);
 assert.throws(()=>normalizeListing({url,latitude:32,longitude:181}),/longitude/);
 assert.throws(()=>normalizeListing({url,location_source:'yad2'}),/coordinate pair/);
 assert.throws(()=>normalizeListing({url,latitude:32,longitude:34,location_accuracy:'building-guessed'}),/accuracy/);
 const {data}=normalizeListing({url,latitude:32,longitude:34,location_source:'address_geocoding',location_accuracy:'street',location_precision_m:50});
 assert.equal(data.location_accuracy,'street');assert.equal(data.location_precision_m,50);
});
