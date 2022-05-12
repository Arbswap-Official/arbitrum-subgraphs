import { Address } from "@graphprotocol/graph-ts";

let ADDRESS_ZERO = Address.fromString("0x0000000000000000000000000000000000000000");

export const swapfactory_address_str: string = "${VARS_SWAPFACTORY_ADDRESS}";
export const swaprouter_address_str: string = "${VARS_SWAPROUTER_ADDRESS}";
export const usdt_address_str: string = "${VARS_USDT_ADDRESS}";
export const eth_address_str: string = "${VARS_ETH_ADDRESS}";
export const receive_fee_address_str: string = "${VARS_RECEIVE_FEE_ADDRESS}";

export let swapfactory_address: Address =
  swapfactory_address_str != ""
    ? Address.fromString(swapfactory_address_str)
    : ADDRESS_ZERO;
export let swaprouter_address: Address =
  swaprouter_address_str != ""
    ? Address.fromString(swaprouter_address_str)
    : ADDRESS_ZERO;
export let usdt_address: Address =
  usdt_address_str != "" ? Address.fromString(usdt_address_str) : ADDRESS_ZERO;
export let eth_address: Address =
  eth_address_str != "" ? Address.fromString(eth_address_str) : ADDRESS_ZERO;
export let receive_fee_address: Address =
  receive_fee_address_str != ""
    ? Address.fromString(receive_fee_address_str)
    : ADDRESS_ZERO;
