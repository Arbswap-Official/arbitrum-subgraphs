/* eslint-disable prefer-const */
import {
  ERC20 as ERC20Template,
  SwapPair as SwapPairTemplate,
} from "../generated/templates";
import { SwapFactory as SwapFactoryContract } from "../generated/templates/SwapPair/SwapFactory";
import { PairCreated as PairCreatedEvent } from "../generated/SwapFactory/SwapFactory";
import { ERC20 } from "../generated/SwapFactory/ERC20";
import { SwapPair } from "../generated/templates/SwapPair/SwapPair";

import { Token, Pair, TotalToken, WhiteListToken } from "../generated/schema";
import { log } from "@graphprotocol/graph-ts";
import { BigInt, Address } from "@graphprotocol/graph-ts";
import { ZERO, ZERO_BD, ADDRESS_ZERO } from "../../common";
import { swapfactory_address } from "../../common/envVars";

export function handlePairCreated(event: PairCreatedEvent): void {
  // create or load the tokens
  let token0 = Token.load(event.params.token0.toHexString());
  let token1 = Token.load(event.params.token1.toHexString());

  if (token0 === null) {
    token0 = new Token(event.params.token0.toHexString());
    token0.symbol = fetchTokenSymbol(event.params.token0);
    token0.name = fetchTokenName(event.params.token0);
    let decimals = fetchTokenDecimals(event.params.token0);
    if (decimals.equals(ZERO)) {
      log.debug("token decimals 0", []);
      return;
    }
    token0.decimals = decimals;
    token0.usdPrice = ZERO_BD;
    token0.ethPrice = ZERO_BD;
    token0.liquidity = ZERO_BD;
    token0.liquidityInUsd = ZERO_BD;
    token0.liquidityInEth = ZERO_BD;
    token0.timestamp = event.block.timestamp;
    token0.block = event.block.number;
    token0.save();

    // create ERC20 contract template
    ERC20Template.create(event.params.token0);

    let totalToken = TotalToken.load("totaltoken");
    if (totalToken === null) {
      totalToken = new TotalToken("totaltoken");
      totalToken.tokens = [];
    }

    let tokens = totalToken.tokens;
    totalToken.tokens = tokens.concat([event.params.token0.toHexString()]);
    totalToken.save();
  }

  if (token1 === null) {
    token1 = new Token(event.params.token1.toHexString());
    token1.symbol = fetchTokenSymbol(event.params.token1);
    token1.name = fetchTokenName(event.params.token1);
    let decimals = fetchTokenDecimals(event.params.token1);
    if (decimals.equals(ZERO)) {
      log.debug("token decimals 0", []);
      return;
    }
    token1.decimals = decimals;
    token1.usdPrice = ZERO_BD;
    token1.ethPrice = ZERO_BD;
    token1.liquidity = ZERO_BD;
    token1.liquidityInUsd = ZERO_BD;
    token1.liquidityInEth = ZERO_BD;
    token1.timestamp = event.block.timestamp;
    token1.block = event.block.number;
    token1.save();

    // create ERC20 contract template
    ERC20Template.create(event.params.token1);

    let totalToken = TotalToken.load("totaltoken");
    if (totalToken === null) {
      totalToken = new TotalToken("totaltoken");
      totalToken.tokens = [];
    }

    let tokens = totalToken.tokens;
    totalToken.tokens = tokens.concat([event.params.token1.toHexString()]);
    totalToken.save();
  }

  let pair = Pair.load(event.params.pair.toHexString());
  if (pair === null) {
    pair = new Pair(event.params.pair.toHexString());
    pair.token0 = token0.id;
    pair.token1 = token1.id;
    pair.token0Price = ZERO_BD;
    pair.token1Price = ZERO_BD;
    pair.reserve0 = ZERO_BD;
    pair.reserve1 = ZERO_BD;
    pair.supply = ZERO_BD;
    pair.totalToken0Volume = ZERO_BD;
    pair.totalToken1Volume = ZERO_BD;
    pair.totalVolumeUsd = ZERO_BD;
    let decimals = fetchTokenDecimals(event.params.pair);
    if (decimals.equals(ZERO)) {
      log.debug("token decimals 0", []);
      return;
    }

    pair.decimals = decimals;
    pair.timestamp = event.block.timestamp;
    pair.block = event.block.number;
    pair.save();

    SwapPairTemplate.create(event.params.pair);
  }
}

export function fetchTokenSymbol(token: Address): string {
  let contract = ERC20.bind(token);
  let symbol = "unknown";
  let result = contract.try_symbol();
  if (!result.reverted) {
    symbol = result.value;
  }
  return symbol;
}

export function fetchTokenName(token: Address): string {
  let contract = ERC20.bind(token);
  let name = "unknown";
  let result = contract.try_name();
  if (!result.reverted) {
    name = result.value;
  }
  return name;
}

export function fetchTokenDecimals(token: Address): BigInt {
  let contract = ERC20.bind(token);
  let decimal = 18;
  let result = contract.try_decimals();
  if (!result.reverted) {
    decimal = result.value;
  }
  return BigInt.fromI32(decimal as i32);
}

export function fetchTokenAddressesFromPair(token: Address): Address[] {
  let contract = SwapPair.bind(token);
  let token0 = contract.token0();
  let token1 = contract.token1();

  return [token0, token1];
}

export function fetchPairForTokenAddress(token0: Address, token1: Address): Address {
  let swapFactoryContract = SwapFactoryContract.bind(swapfactory_address);
  let pairId = ADDRESS_ZERO;
  let result = swapFactoryContract.try_getPair(token0, token1);
  if (!result.reverted) {
    pairId = result.value;
  }
  return pairId;
}
