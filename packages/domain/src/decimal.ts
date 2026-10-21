/** Canonical nonnegative decimals: 30 integral digits and 18 fractional digits. */
export const DECIMAL_SCALE=10n**18n;
export function decimalAmount(value:string):bigint {
 if(!/^\d{1,30}(?:\.\d{1,18})?$/u.test(value))throw Error("DECIMAL_INVALID");
 const [whole,fraction=""]=value.split(".");return BigInt(whole!)*DECIMAL_SCALE+BigInt(fraction.padEnd(18,"0"));
}
export function decimalString(value:bigint):string {
 if(value<0n)throw Error("DECIMAL_NEGATIVE");
 const whole=value/DECIMAL_SCALE,fraction=(value%DECIMAL_SCALE).toString().padStart(18,"0").replace(/0+$/u,"");return `${whole}${fraction?`.${fraction}`:""}`;
}

/** Expand the stored JS/JSON representation; it cannot recover upstream precision. */
export function storedNumberDecimal(value:unknown):string|undefined{
  if(typeof value!=="number"||!Number.isFinite(value)||value<0||Number.isInteger(value)&&!Number.isSafeInteger(value))return;
  const [coefficient,exponent="0"]=String(value).toLowerCase().split("e");
  const [whole,fraction=""]=coefficient!.split("."),digits=whole!+fraction,position=whole!.length+Number(exponent);
  if(position>30||Math.max(0,digits.length-position)>18)return;
  const expanded=position<=0?`0.${"0".repeat(-position)}${digits}`:position>=digits.length?digits+"0".repeat(position-digits.length):`${digits.slice(0,position)}.${digits.slice(position)}`;
  return /^\d{1,30}(?:\.\d{1,18})?$/u.test(expanded)?expanded:undefined;
}
