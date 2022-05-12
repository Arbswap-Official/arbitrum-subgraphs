import { Bytes, BigInt, ByteArray, Address, BigDecimal } from "@graphprotocol/graph-ts";

export let ZERO = BigInt.fromI32(0);
export let ZERO_BD = BigDecimal.fromString("0");
export let ONE = BigInt.fromI32(1);
export let ONEHOURH = BigInt.fromI32(24);
export let ONEHOURS = BigInt.fromI32(3600);
export let ONEMINUTE = BigInt.fromI32(60);
export let ONEDAY = BigInt.fromI32(86400);
export let SEVENDAY = BigInt.fromI32(604800);
export let BI_18 = BigInt.fromI32(18);
export let ADDRESS_ZERO = Address.fromString(
  "0x0000000000000000000000000000000000000000"
);

export function strToBytes(string: string, length: i32 = 32): Bytes {
  let utf8 = string.toUTF8();
  let bytes = new ByteArray(length);
  let strLen = string.lengthUTF8 - 1;
  for (let i: i32 = 0; i < strLen; i++) {
    bytes[i] = load<u8>(utf8 + i);
  }
  return bytes as Bytes;
}

export function exponentToBigDecimal(decimals: BigInt): BigDecimal {
  let amount = BigDecimal.fromString("1");
  for (let i = ZERO; i.lt(decimals as BigInt); i = i.plus(ONE)) {
    amount = amount.times(BigDecimal.fromString("10"));
  }
  return amount;
}

export function convertTokenToDecimal(amount: BigInt, decimals: BigInt): BigDecimal {
  if (decimals == ZERO) {
    return amount.toBigDecimal();
  }
  return amount.toBigDecimal().div(exponentToBigDecimal(decimals));
}

let EPSILON = BigDecimal.fromString("2.2204460492503130808472633361816e-16");
let ONE_BD = BigDecimal.fromString("1");
let TWO_BD = BigDecimal.fromString("2");

export function sqrt(n: BigDecimal): BigDecimal {
  if (n.lt(ZERO_BD)) return ZERO_BD;
  if (n.equals(ZERO_BD) || n.equals(ONE_BD)) return n;
  let val = n;
  let last = ZERO_BD;
  do {
    last = val;
    val = val.plus(n.div(val)).div(TWO_BD);
  } while (abs(val.minus(last)) >= EPSILON);
  return val;
}

function abs(number: BigDecimal): BigDecimal {
  if (number.lt(ZERO_BD)) {
    return number.neg();
  }
  return number;
}
