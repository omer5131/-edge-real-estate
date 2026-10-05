// Display adapter only: preserve each server benchmark's sign convention.
export function benchmarkGap(value:unknown,positiveMeansBelow:boolean){
 if(value==null||value==='')return 'לא ידוע';
 const n=Number(value);if(!Number.isFinite(n))return 'לא ידוע';
 if(Math.abs(n)<.05)return 'בסביבת המדד';
 return `${Math.abs(n).toFixed(1)}% ${((n>0)===positiveMeansBelow)?'מתחת':'מעל'} למדד`;
}
