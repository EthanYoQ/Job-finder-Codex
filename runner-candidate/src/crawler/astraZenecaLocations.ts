import { explicitlyForeignOrNonMainlandLocation } from './officialJsonEvidence';

/** Reviewed explicit city/region pairs and aliases; titles may only veto a city.
 * Unfamiliar China-positive labels are pending, never guessed from a title/URL. */
const places: readonly [string,string,readonly string[],readonly string[]][] = [
  ['北京','北京',['Beijing','北京市'],['Beijing']],['上海','上海',['Shanghai','上海市'],['Shanghai']],
  ['广州','广东',['Guangzhou','广州市'],['Guangdong']],['无锡','江苏',['Wuxi','无锡市'],['Jiangsu']],
  ['济南','山东',['Jinan','济南市'],['Shandong']],['武汉','湖北',['Wuhan','武汉市'],['Hubei']],
  ['青岛','山东',['Qingdao','青岛市'],['Shandong']],['福州','福建',['Fuzhou','福州市'],['Fujian','福建省']],
  ['徐州','江苏',['Xuzhou','徐州市'],['Jiangsu']],['南京','江苏',['Nanjing','南京市'],['Jiangsu']],
  ['昆明','云南',['Kunming','昆明市'],['Yunnan']],['苏州','江苏',['Suzhou','苏州市'],['Jiangsu']],
  ['咸阳','陕西',['Xianyang','咸阳市'],['Shaanxi']],['长沙','湖南',['Changsha','长沙市'],['Hunan']],
  ['深圳','广东',['Shenzhen','深圳市'],['Guangdong']],['达州','四川',['Dazhou','达州市'],['Sichuan']],
  ['重庆','重庆',['Chongqing','重庆市'],['Chongqing']],['成都','四川',['Chengdu','成都市'],['Sichuan']],
  ['杭州','浙江',['Hangzhou','杭州市'],['Zhejiang']],['郑州','河南',['Zhengzhou','郑州市'],['Henan']],
  ['沈阳','辽宁',['Shenyang','沈阳市','沉阳市'],['Liaoning']],['石家庄','河北',['Shijiazhuang','石家庄市'],['Hebei']],
  ['宁波','浙江',['Ningbo','宁波市'],['Zhejiang']],['舟山','浙江',['Zhoushan','舟山市'],['Zhejiang']],
  ['长春','吉林',['Changchun','长春市'],['Jilin']],['西安','陕西',["Xi'an",'Xian','西安市'],['Shaanxi']],
  ['烟台','山东',['Yantai','烟台市'],['Shandong']],['娄底','湖南',['Loudi','娄底市'],['Hunan']],
  ['东莞','广东',['Dongguan','东莞市'],['Guangdong']],['珠海','广东',['Zhuhai','珠海市'],['Guangdong']],
  ['大连','辽宁',['Dalian','大连市'],['Liaoning']],['太原','山西',['Taiyuan','太原市'],['Shanxi']],
  ['铁岭','辽宁',['Tieling','铁岭市'],['Liaoning']],['郴州','湖南',['Chenzhou','郴州市'],['Hunan']],
  ['南昌','江西',['Nanchang','南昌市'],['Jiangxi']],['锦州','辽宁',['Jinzhou','锦州市'],['Liaoning']],
  ['威海','山东',['Weihai','威海市'],['Shandong']],['哈尔滨','黑龙江',['Harbin','哈尔滨市'],['Heilongjiang']],
  ['合肥','安徽',['Hefei','合肥市'],['Anhui']]
];
const key=(s:string)=>s.trim().toLowerCase();
export const isAstraZenecaChina=(s:string)=>['中国','cn','china'].includes(key(s));
const nonMainland=/(香港|澳门|澳門|台湾|臺灣|hong\s*kong|macau|macao|taiwan)/iu;
const mainlandRegions=new Set('北京 上海 天津 重庆 河北 山西 辽宁 吉林 黑龙江 江苏 浙江 安徽 福建 江西 山东 河南 湖北 湖南 广东 海南 四川 贵州 云南 陕西 甘肃 青海 内蒙古 广西 西藏 宁夏 新疆'.split(' '));
export function astraZenecaRegion(region:string):string|undefined{
  const chinese=region.replace(/省$/u,'');if(mainlandRegions.has(chinese))return chinese;
  const alias:Record<string,string>={tianjin:'天津',xinjiang:'新疆',guangxi:'广西'};if(alias[key(region)])return alias[key(region)];
  return places.find(([,r,,ra])=>[r,...ra].some(v=>key(v)===key(region)))?.[1];
}
export function astraZenecaCity(city:string,region:string):string|undefined{
  return places.find(([c,r,ca,ra])=>[c,...ca].some(v=>key(v)===key(city))&&[r,r+'省',...ra].some(v=>key(v)===key(region)))?.[0];
}
export function assertAstraZenecaMainlandParts(city:string,region:string):void{
  if(nonMainland.test(city+' '+region)||explicitlyForeignOrNonMainlandLocation(city)||explicitlyForeignOrNonMainlandLocation(region))throw Error('DETAIL_COUNTRY_INVALID');
  // An unknown city may remain pending only with a positive mainland region.
  if(region && !astraZenecaRegion(region))throw Error('DETAIL_COUNTRY_INVALID');
}
export function astraZenecaListCity(raw:string):string|undefined{
  const parts=astraZenecaListLocation(raw);return parts?astraZenecaCity(parts.city,parts.region):undefined;
}
export function astraZenecaListLocation(raw:string):{city:string;region:string}|undefined{
  if(raw==='Multiple locations'||isAstraZenecaChina(raw))return undefined;
  const province=astraZenecaRegion(raw);if(province)return {city:'',region:province};
  const parts=raw.trim().split(/\s+/u);const region=parts.shift()??'',city=parts.join(' ');
  if(!city||!region)throw Error('ASTRAZENECA_LIST_COUNTRY_INVALID');
  try{assertAstraZenecaMainlandParts(city,region);}catch{throw Error('ASTRAZENECA_LIST_COUNTRY_INVALID');}
  return {city,region};
}
export function astraZenecaTitleDisagrees(title:string,cities:readonly string[]):boolean{
  const mentioned=places.filter(([city,,aliases])=>[city,...aliases].some(alias=>{
    if(/[\u3400-\u9fff]/u.test(alias))return title.includes(alias);
    const escaped=alias.replace(/[.*+?^${}()|[\]\\]/gu,'\\$&');return new RegExp(`(?:^|[^a-z])${escaped}(?=$|[^a-z])`,'iu').test(title);
  })).map(([city])=>city);
  return mentioned.some(city=>!cities.includes(city));
}
