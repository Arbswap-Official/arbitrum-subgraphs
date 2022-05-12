import { Approval as ApprovalEvent } from "../generated/templates/ERC20/ERC20";
import {
  Sync as SyncEvent,
  Swap as SwapEvent,
  Approval as PairApprovalEvent,
  Mint as MintEvent,
  Burn as BurnEvent,
  Transfer as TransferEvent,
  Freeze as FreezeEvent,
  SwapPair,
} from "../generated/templates/SwapPair/SwapPair";
import { SwapFactory as SwapFactoryContract } from "../generated/templates/SwapPair/SwapFactory";
import { ERC20 } from "../generated/templates/SwapPair/ERC20";
import { fetchPairForTokenAddress } from "../src/swapFactory";

import {
  Pair,
  Token,
  TotalLiquidityInSymbolByDay,
  Approval,
  PairApproval,
  Swap,
  PairPricesLast,
  PairPricesMinuter,
  PairPricesHour,
  PairPricesDay,
  PairPricesEvery,
  PairVolumeMinuter,
  PairVolumeHour,
  PairVolumeDay,
  TokenVolumeHour,
  TokenUsdPriceHour,
  TokenUsdPriceEvery,
  TotalVolumeInSymbolByDay,
  TotalVolumeInSymbolByHour,
  Transaction,
  SwapPairFeeInfoByLast,
  SwapPairFeeInfoByHour,
  Mint,
  Burn,
  TotalToken,
  FreezePair,
  UserLpTokenAvailable,
  WhiteListToken,
} from "../generated/schema";

import {
  store,
  BigInt,
  BigDecimal,
  ethereum,
  Address,
  log,
} from "@graphprotocol/graph-ts";
import {
  swaprouter_address,
  eth_address,
  eth_address_str,
  usdt_address,
  receive_fee_address,
} from "../../common/envVars";
import {
  ZERO_BD,
  ONE,
  ONEDAY,
  ONEHOURS,
  ONEMINUTE,
  BI_18,
  convertTokenToDecimal,
  ADDRESS_ZERO,
  sqrt,
  ZERO,
} from "../../common";

export function handleApproval(event: ApprovalEvent): void {
  //过滤掉路由的 Approval
  if (event.transaction.to == swaprouter_address) {
    return;
  }

  //当用钱的地方不是我们自己不记
  if (event.params.spender != swaprouter_address) {
    return;
  }

  let approval = new Approval(
    event.transaction.hash.toHex() + "-" + event.logIndex.toString()
  );

  let token = Token.load(event.address.toHex());
  approval.source = token.symbol;
  approval.sourceAddress = event.address;
  approval.transactionHash = event.transaction.hash;
  approval.owner = event.params.owner;
  approval.spender = event.params.spender;
  approval.value = convertTokenToDecimal(event.params.value, token.decimals);
  approval.timestamp = event.block.timestamp;
  approval.block = event.block.number;
  approval.save();
}

export function handlePairApproval(event: PairApprovalEvent): void {
  if (event.transaction.to == swaprouter_address) {
    return;
  }

  //当用钱的地方不是我们自己不记
  if (event.params.spender != swaprouter_address) {
    return;
  }

  let pairApproval = new PairApproval(
    event.transaction.hash.toHex() + "-" + event.logIndex.toString()
  );

  pairApproval.pair = event.address.toHex();
  pairApproval.transactionHash = event.transaction.hash;
  pairApproval.owner = event.params.owner;
  pairApproval.spender = event.params.spender;
  pairApproval.value = convertTokenToDecimal(event.params.value, BI_18);
  pairApproval.timestamp = event.block.timestamp;
  pairApproval.block = event.block.number;
  pairApproval.save();
}

export function handleSwap(event: SwapEvent): void {
  let pair = Pair.load(event.address.toHexString());
  let token0 = Token.load(pair.token0);
  let token1 = Token.load(pair.token1);
  let amount0In = convertTokenToDecimal(event.params.amount0In, token0.decimals);
  let amount1In = convertTokenToDecimal(event.params.amount1In, token1.decimals);
  let amount0Out = convertTokenToDecimal(event.params.amount0Out, token0.decimals);
  let amount1Out = convertTokenToDecimal(event.params.amount1Out, token1.decimals);

  let pay = pair.token1;
  let receive = pair.token0;
  let payAmount = ZERO_BD;
  let receiveAmount = ZERO_BD;

  if (amount0In.equals(ZERO_BD)) {
    pay = pair.token1;
    receive = pair.token0;

    payAmount = amount1In.minus(amount1Out);
    receiveAmount = amount0Out.minus(amount0In);
  } else if (amount1In.equals(ZERO_BD)) {
    pay = pair.token0;
    receive = pair.token1;

    payAmount = amount0In.minus(amount0Out);
    receiveAmount = amount1Out.minus(amount1In);
  } else {
    //双边转换
    payAmount = amount0Out.minus(amount0In);
    receiveAmount = amount1Out.minus(amount1In);
  }

  let swap = Swap.load(event.transaction.hash.toHex());
  if (swap == null) {
    swap = new Swap(event.transaction.hash.toHex());
    swap.transactionHash = event.transaction.hash;
    swap.sender = event.params.sender;
    swap.from = event.transaction.from;
    swap.pair = pair.id;
    swap.pay = pay;
    swap.receive = receive;
    swap.payAmount = payAmount;
    swap.receiveAmount = receiveAmount;
    swap.amount0In = amount0In;
    swap.amount1In = amount1In;
    swap.amount0Out = amount0Out;
    swap.amount1Out = amount1Out;
    swap.to = event.params.to;
    swap.timestamp = event.block.timestamp;
    swap.block = event.block.number;
  } else {
    swap.receive = receive;
    swap.receiveAmount = receiveAmount;
  }

  swap.save();

  let totalAmount0 = ZERO_BD;
  let totalAmount1 = ZERO_BD;
  //统计每一边的实际交易量
  if (amount0In.equals(ZERO_BD)) {
    //单边转换
    totalAmount0 = amount0In.plus(amount0Out);
    totalAmount1 = amount1In.minus(amount1Out);
  } else if (amount1In.equals(ZERO_BD)) {
    //单边转换
    totalAmount0 = amount0In.minus(amount0Out);
    totalAmount1 = amount1In.plus(amount1Out);
  } else {
    //双边转换
    totalAmount0 = amount0In.minus(amount0Out);
    totalAmount1 = amount1In.minus(amount1Out);
  }

  //统计交易量
  //是否需要换路由,判断是否为空地址的原因是减少合约调用
  let totalVolumeUSD = ZERO_BD;
  let token0VolumeUSD = ZERO_BD;
  let token1VolumeUSD = ZERO_BD;
  if (Address.fromString(token0.id) == usdt_address) {
    token0VolumeUSD = totalAmount0;
    token1VolumeUSD = totalAmount1.div(pair.token1Price);
    totalVolumeUSD = totalAmount0.plus(token1VolumeUSD);
  } else if (Address.fromString(token1.id) == usdt_address) {
    token0VolumeUSD = totalAmount0.div(pair.token0Price);
    token1VolumeUSD = totalAmount1;
    totalVolumeUSD = totalAmount1.plus(token0VolumeUSD);
  } else {
    token0VolumeUSD = getTokenAmountUSD(totalAmount0, token0 as Token);
    token1VolumeUSD = getTokenAmountUSD(totalAmount1, token1 as Token);
    totalVolumeUSD = token0VolumeUSD.plus(token1VolumeUSD);
  }

  //这一笔按单边统计的话价值单边多少个token
  let token0Volume = totalAmount0.plus(totalAmount1.div(pair.token1Price));
  let token1Volume = totalAmount1.plus(totalAmount0.div(pair.token0Price));
  pairVolumeUpdated(token0Volume, token1Volume, totalVolumeUSD, pair as Pair, event);

  TokenVolumeUpdated(
    totalAmount0,
    totalAmount1,
    token0VolumeUSD,
    token1VolumeUSD,
    pair as Pair,
    event
  );

  //更新这一笔的手续费到总的pair 手续费里去
  pairFeeUpdated(pair as Pair, event);
}

function getTokenAmountUSD(amount: BigDecimal, token: Token): BigDecimal {
  if (Address.fromString(token.id) == usdt_address) {
    return amount;
  }

  let price = getTokenUSDPrice(token);
  if (price == ZERO_BD) {
    let ethPrice = getTokenEthPrice(token);
    let eth = WhiteListToken.load(eth_address_str);
    price = ethPrice.times(eth.usdPrice);
  }
  return amount.times(price);
}

//获取token对于usd的价格
function getTokenUSDPrice(token: Token): BigDecimal {
  if (Address.fromString(token.id) == usdt_address) {
    return BigDecimal.fromString("1");
  }

  //去查询每一个token有没有直接对于usdt的pair
  let usdPairId = fetchPairForTokenAddress(Address.fromString(token.id), usdt_address);

  //如果有usdt pair的话就采用usdt pair相关的数据
  let usdPair = Pair.load(usdPairId.toHexString());
  if (usdPair != null) {
    if (Address.fromString(usdPair.token0) == usdt_address) {
      return usdPair.token0Price;
    } else {
      return usdPair.token1Price;
    }
  } else {
    return ZERO_BD;
  }
}

//获取token对于eth的价格
function getTokenEthPrice(token: Token): BigDecimal {
  if (Address.fromString(token.id) == eth_address) {
    return BigDecimal.fromString("1");
  }

  let pairId = fetchPairForTokenAddress(Address.fromString(token.id), eth_address);
  let pair = Pair.load(pairId.toHexString());
  if (pair == null) {
    return ZERO_BD;
  }

  if (Address.fromString(pair.token0) == eth_address) {
    return pair.token0Price;
  } else {
    return pair.token1Price;
  }
}

export function handleSync(event: SyncEvent): void {
  let pair = Pair.load(event.address.toHex());
  let token0 = Token.load(pair.token0);
  let token1 = Token.load(pair.token1);
  let reserve0 = convertTokenToDecimal(event.params.reserve0, token0.decimals);
  let reserve1 = convertTokenToDecimal(event.params.reserve1, token1.decimals);

  //保存每一个token的liquidity
  let change = ZERO_BD;
  if (pair.reserve0.ge(reserve0)) {
    change = pair.reserve0.minus(reserve0);
    //流动性减少了
    token0.liquidity = token0.liquidity.minus(change);
  } else {
    change = reserve0.minus(pair.reserve0);
    token0.liquidity = token0.liquidity.plus(change);
  }

  if (pair.reserve1.ge(reserve1)) {
    change = pair.reserve1.minus(reserve1);
    //流动性减少了
    token1.liquidity = token1.liquidity.minus(change);
  } else {
    change = reserve1.minus(pair.reserve1);
    token1.liquidity = token1.liquidity.plus(change);
  }

  token0.save();
  token1.save();

  //保存价格和池子的深度等数据
  pairPricesUpdated(reserve0, reserve1, pair as Pair, event);
  //必须等更新完pair的price 后再更新token的usd price
  tokenUsdPriceUpdated(token0 as Token, token1 as Token, pair as Pair, event);
  //记录所有的token的liquidityInUsd,按天快照
  totalLiquidityUpdated(event);
}

//更新pair 的手续费部分
function pairFeeUpdated(pair: Pair, event: ethereum.Event): void {
  let timestamp = event.block.timestamp;
  let timeHour = timestamp.div(ONEHOURS);
  let eth = Token.load(eth_address.toHexString());
  let ethPrice = getTokenUSDPrice(eth as Token);

  let swapPairFeeInfoByLast = SwapPairFeeInfoByLast.load(pair.id);
  let k1 = swapPairFeeInfoByLast.lastK;
  let k2 = swapPairFeeInfoByLast.nowk;

  //计算当前这笔swap手续费
  let nowFree = BigDecimal.fromString("5")
    .times(sqrt(k2).minus(sqrt(k1)))
    .div(BigDecimal.fromString("5").times(sqrt(k2).plus(sqrt(k1))))
    .times(sqrt(k1));

  swapPairFeeInfoByLast.totalFeeValue = swapPairFeeInfoByLast.totalFeeValue.plus(
    nowFree.times(ethPrice)
  );

  swapPairFeeInfoByLast.totalFeeTokenValue =
    swapPairFeeInfoByLast.totalFeeTokenValue.plus(nowFree);

  swapPairFeeInfoByLast.ethPrice = ethPrice;
  swapPairFeeInfoByLast.timestamp = timestamp;
  swapPairFeeInfoByLast.block = event.block.number;
  swapPairFeeInfoByLast.save();

  //FreeHour
  let HourId = timeHour.toString() + "-" + pair.id;
  let swapPairFeeInfoByHour = SwapPairFeeInfoByHour.load(HourId);
  if (swapPairFeeInfoByHour == null) {
    swapPairFeeInfoByHour = new SwapPairFeeInfoByHour(HourId);
    swapPairFeeInfoByHour.pair = pair.id;
  }

  swapPairFeeInfoByHour.k = k2;
  swapPairFeeInfoByHour.totalFeeValue = swapPairFeeInfoByLast.totalFeeValue;
  swapPairFeeInfoByHour.timestampHour = timeHour;
  swapPairFeeInfoByHour.timestamp = timestamp;
  swapPairFeeInfoByHour.block = event.block.number;
  swapPairFeeInfoByHour.save();
}

function tokenUsdPriceUpdated(
  token0: Token,
  token1: Token,
  pair: Pair,
  event: ethereum.Event
): void {
  let token0UsdPrice = getTokenUSDPrice(token0);
  let token1UsdPrice = getTokenUSDPrice(token1);

  //更新白名单价格
  let updateWls = false;
  let ethPrice = ZERO_BD;
  if (token0.id == eth_address_str) {
    updateWls = true;
    ethPrice = token0UsdPrice;
  } else if (token1.id == eth_address_str) {
    updateWls = true;
    ethPrice = token1UsdPrice;
  }

  let eth = WhiteListToken.load(eth_address_str);
  if (eth == null) {
    eth = new WhiteListToken(eth_address_str);
    eth.address = eth_address;
    eth.usdPrice = ZERO_BD;
  }
  if (updateWls) {
    eth.usdPrice = ethPrice;
  }
  eth.save();

  let token0EthPrice = ZERO_BD;
  let token1EthPrice = ZERO_BD;
  if (token0UsdPrice != ZERO_BD) {
    token0.usdPrice = token0UsdPrice;
    token0.liquidityInUsd = token0UsdPrice.times(token0.liquidity);
  } else {
    token0EthPrice = getTokenEthPrice(token0);
    token0.ethPrice = token0EthPrice;
    token0.liquidityInEth = token0EthPrice.times(token0.liquidity);
  }

  if (token1UsdPrice != ZERO_BD) {
    token1.usdPrice = token1UsdPrice;
    token1.liquidityInUsd = token1UsdPrice.times(token1.liquidity);
  } else {
    token1EthPrice = getTokenEthPrice(token1);
    token1.ethPrice = token1EthPrice;
    token1.liquidityInEth = token1EthPrice.times(token1.liquidity);
  }

  token0.save();
  token1.save();

  let timestamp = event.block.timestamp;
  let blockNumber = event.block.number;
  let timeHour = timestamp.div(ONEHOURS);

  //token0 price Hour
  let token0HourId = timeHour.toString() + "-" + token0.id;
  let token0UsdPriceHour = TokenUsdPriceHour.load(token0HourId);
  if (token0UsdPriceHour == null) {
    token0UsdPriceHour = new TokenUsdPriceHour(token0HourId);
    token0UsdPriceHour.token = token0.id;
  }
  if (token0UsdPrice != ZERO_BD) {
    token0UsdPriceHour.price = token0UsdPrice;
  } else {
    token0UsdPriceHour.price = token0EthPrice.times(eth.usdPrice);
  }
  token0UsdPriceHour.timestampHour = timeHour;
  token0UsdPriceHour.timestamp = timestamp;
  token0UsdPriceHour.block = blockNumber;
  token0UsdPriceHour.save();

  //token1 price Hour
  let token1HourId = timeHour.toString() + "-" + token1.id;
  let token1UsdPriceHour = TokenUsdPriceHour.load(token1HourId);
  if (token1UsdPriceHour == null) {
    token1UsdPriceHour = new TokenUsdPriceHour(token1HourId);
    token1UsdPriceHour.token = token1.id;
  }
  if (token1UsdPrice != ZERO_BD) {
    token1UsdPriceHour.price = token1UsdPrice;
  } else {
    token1UsdPriceHour.price = token1EthPrice.times(eth.usdPrice);
  }
  token1UsdPriceHour.timestampHour = timeHour;
  token1UsdPriceHour.timestamp = timestamp;
  token1UsdPriceHour.block = blockNumber;
  token1UsdPriceHour.save();

  //token0 price Every
  let token0TimeId = timestamp.toString() + "-" + token0.id;
  let token0UsdPriceEvery = new TokenUsdPriceEvery(token0TimeId);
  if (token0UsdPrice != ZERO_BD) {
    token0UsdPriceEvery.price = token0UsdPrice;
  } else {
    token0UsdPriceEvery.price = token0EthPrice.times(eth.usdPrice);
  }
  token0UsdPriceEvery.token = token0.id;
  token0UsdPriceEvery.timestamp = timestamp;
  token0UsdPriceEvery.block = blockNumber;
  token0UsdPriceEvery.save();

  //token1 price Every
  let token1TimeId = timestamp.toString() + "-" + token1.id;
  let token1UsdPriceEvery = new TokenUsdPriceEvery(token1TimeId);
  if (token1UsdPrice != ZERO_BD) {
    token1UsdPriceEvery.price = token1UsdPrice;
  } else {
    token1UsdPriceEvery.price = token1EthPrice.times(eth.usdPrice);
  }
  token1UsdPriceEvery.token = token1.id;
  token1UsdPriceEvery.timestamp = timestamp;
  token1UsdPriceEvery.block = blockNumber;
  token1UsdPriceEvery.save();

  //PairPricesEvery 的 tokenUsdPrice 记录
  let timestampId = timestamp.toString() + "-" + pair.id;
  let pairPricesEvery = new PairPricesEvery(timestampId);
  if (token0UsdPrice != ZERO_BD) {
    pairPricesEvery.token0UsdPrice = token0UsdPrice;
  } else {
    pairPricesEvery.token0UsdPrice = token0EthPrice.times(eth.usdPrice);
  }
  if (token1UsdPrice != ZERO_BD) {
    pairPricesEvery.token1UsdPrice = token1UsdPrice;
  } else {
    pairPricesEvery.token1UsdPrice = token1EthPrice.times(eth.usdPrice);
  }
  pairPricesEvery.save();
}

//总的流动性按天快照
function totalLiquidityUpdated(event: ethereum.Event): void {
  let eth = WhiteListToken.load(eth_address_str);
  let totalValue = ZERO_BD;
  let totalToken = TotalToken.load("totaltoken");
  let tokenarrs = totalToken.tokens;
  for (let i = 0; i < tokenarrs.length; i++) {
    let token = Token.load(tokenarrs[i]);
    //当某些token还没有创建时
    if (token != null) {
      if (token.liquidityInUsd != null && token.liquidityInUsd != ZERO_BD) {
        totalValue = totalValue.plus(token.liquidityInUsd as BigDecimal);
      } else if (token.liquidityInEth != null && token.liquidityInEth != ZERO_BD) {
        let value = token.liquidityInEth.times(eth.usdPrice);
        totalValue = totalValue.plus(value);
      }
    }
  }

  let timestamp = event.block.timestamp;
  let timeDay = timestamp.div(ONEDAY);

  let showTime = timeDay.times(ONEDAY);
  let periodOfDay = BigInt.fromI32(57600);
  let interval = timestamp.minus(showTime); //因舍弃余数的时间误差
  if (interval.ge(periodOfDay)) {
    timeDay = timeDay.plus(ONE); //当相隔时间差距大于16小时时，说明到了新的一天了，该往记录为新的一天的数据
  }

  let DayId = timeDay.toString() + "-USD";
  let totalLiquidityInSymbolByDay = TotalLiquidityInSymbolByDay.load(DayId);
  if (totalLiquidityInSymbolByDay == null) {
    totalLiquidityInSymbolByDay = new TotalLiquidityInSymbolByDay(DayId);
    totalLiquidityInSymbolByDay.symbol = "USD";
    totalLiquidityInSymbolByDay.timestampDay = timeDay;
  }

  totalLiquidityInSymbolByDay.totalValue = totalValue;
  totalLiquidityInSymbolByDay.timestamp = event.block.timestamp;
  totalLiquidityInSymbolByDay.block = event.block.number;
  totalLiquidityInSymbolByDay.save();
}

function pairPricesUpdated(
  reserve0: BigDecimal,
  reserve1: BigDecimal,
  pair: Pair,
  event: ethereum.Event
): void {
  let timestamp = event.block.timestamp;
  let blockNumber = event.block.number;
  let timeDay = timestamp.div(ONEDAY);
  let timeHour = timestamp.div(ONEHOURS);
  let timeMinute = timestamp.div(ONEMINUTE);

  let token0Price = ZERO_BD;
  let token1Price = ZERO_BD;
  if (reserve1.notEqual(ZERO_BD)) token0Price = reserve0.div(reserve1);
  if (reserve0.notEqual(ZERO_BD)) token1Price = reserve1.div(reserve0);

  pair.reserve0 = reserve0;
  pair.reserve1 = reserve1;
  pair.token0Price = token0Price;
  pair.token1Price = token1Price;
  // pair.supply = supply_BD;
  pair.save();

  //更改最新的一笔k值,和记录上一次的k值
  let k = pair.reserve0.times(pair.reserve1);
  let swapPairFeeInfoByLast = SwapPairFeeInfoByLast.load(pair.id);
  if (swapPairFeeInfoByLast == null) {
    swapPairFeeInfoByLast = new SwapPairFeeInfoByLast(pair.id);
    swapPairFeeInfoByLast.pair = pair.id;
    swapPairFeeInfoByLast.totalFeeValue = ZERO_BD;
    swapPairFeeInfoByLast.totalFeeTokenValue = ZERO_BD;
    swapPairFeeInfoByLast.ethPrice = ZERO_BD;
    swapPairFeeInfoByLast.nowk = k;
    swapPairFeeInfoByLast.lastK = k;

    //记录现在和前一笔的token price
    swapPairFeeInfoByLast.nowToken0Price = token0Price;
    swapPairFeeInfoByLast.nowToken1Price = token1Price;
    swapPairFeeInfoByLast.lastToken0Price = token0Price;
    swapPairFeeInfoByLast.lastToken1Price = token1Price;
  } else {
    let lastK = swapPairFeeInfoByLast.nowk;
    swapPairFeeInfoByLast.lastK = lastK;
    swapPairFeeInfoByLast.nowk = k;

    let lastToken0Price = swapPairFeeInfoByLast.nowToken0Price;
    let lastToken1Price = swapPairFeeInfoByLast.nowToken1Price;
    //记录现在和前一笔的token price
    swapPairFeeInfoByLast.lastToken0Price = lastToken0Price;
    swapPairFeeInfoByLast.lastToken1Price = lastToken1Price;
    swapPairFeeInfoByLast.nowToken0Price = token0Price;
    swapPairFeeInfoByLast.nowToken1Price = token1Price;
  }

  swapPairFeeInfoByLast.timestamp = timestamp;
  swapPairFeeInfoByLast.block = event.block.number;
  swapPairFeeInfoByLast.save();

  //pairPricesDay
  //添加判断确保零点过后的数据会当做第二天的数据处理(因为去余数的原因)
  let showTime = timeDay.times(ONEDAY);
  let periodOfDay = BigInt.fromI32(57600);
  let interval = timestamp.minus(showTime); //因舍弃余数的时间误差
  if (interval.ge(periodOfDay)) {
    timeDay = timeDay.plus(ONE); //当相隔时间差距大于16小时时，说明到了新的一天了，该往记录为新的一天的数据
  }

  let DayId = timeDay.toString() + "-" + pair.id;
  let pairPricesDay = PairPricesDay.load(DayId);
  if (pairPricesDay == null) {
    pairPricesDay = new PairPricesDay(DayId);
    pairPricesDay.pair = pair.id;
    //初始化该日内token0 和 token1 的最大最小值
    pairPricesDay.token0high = token0Price;
    pairPricesDay.token1high = token1Price;
    pairPricesDay.token0low = token0Price;
    pairPricesDay.token1low = token1Price;
  } else {
    //记录该日内token0 的最大最小值
    if (pairPricesDay.token0low.gt(token0Price)) {
      pairPricesDay.token0low = token0Price;
    } else if (pairPricesDay.token0high.lt(token0Price)) {
      pairPricesDay.token0high = token0Price;
    }

    //记录该日内token1 的最大最小值
    if (pairPricesDay.token1low.gt(token1Price)) {
      pairPricesDay.token1low = token1Price;
    } else if (pairPricesDay.token1high.lt(token1Price)) {
      pairPricesDay.token1high = token1Price;
    }
  }

  // pairPricesDay.supply = supply_BD;
  pairPricesDay.timestampDay = timeDay;
  pairPricesDay.timestamp = timestamp;
  pairPricesDay.reserve0 = reserve0;
  pairPricesDay.reserve1 = reserve1;
  pairPricesDay.token0Price = token0Price;
  pairPricesDay.token1Price = token1Price;
  pairPricesDay.block = blockNumber;
  pairPricesDay.save();

  //PricesHour
  let HourId = timeHour.toString() + "-" + pair.id;
  let pairPricesHour = PairPricesHour.load(HourId);
  if (pairPricesHour == null) {
    pairPricesHour = new PairPricesHour(HourId);
    pairPricesHour.pair = pair.id;
    //初始化该小时内token0 和 token1 的最大最小值
    pairPricesHour.token0high = token0Price;
    pairPricesHour.token1high = token1Price;
    pairPricesHour.token0low = token0Price;
    pairPricesHour.token1low = token1Price;
  } else {
    //记录该小时内token0 的最大最小值
    if (pairPricesHour.token0low.gt(token0Price)) {
      pairPricesHour.token0low = token0Price;
    } else if (pairPricesHour.token0high.lt(token0Price)) {
      pairPricesHour.token0high = token0Price;
    }

    //记录该小时内token1 的最大最小值
    if (pairPricesHour.token1low.gt(token1Price)) {
      pairPricesHour.token1low = token1Price;
    } else if (pairPricesHour.token1high.lt(token1Price)) {
      pairPricesHour.token1high = token1Price;
    }
  }

  // pairPricesHour.supply = supply_BD;
  pairPricesHour.timestampHour = timeHour;
  pairPricesHour.timestamp = timestamp;
  pairPricesHour.reserve0 = reserve0;
  pairPricesHour.reserve1 = reserve1;
  pairPricesHour.token0Price = token0Price;
  pairPricesHour.token1Price = token1Price;
  pairPricesHour.block = blockNumber;
  pairPricesHour.save();

  //PricesMinuter
  let MinuterId = timeMinute.toString() + "-" + pair.id;
  let pairPricesMinuter = PairPricesMinuter.load(MinuterId);
  if (pairPricesMinuter == null) {
    pairPricesMinuter = new PairPricesMinuter(MinuterId);
    pairPricesMinuter.pair = pair.id;
    //初始化该分钟内token0 和 token1 的最大最小值
    pairPricesMinuter.token0high = token0Price;
    pairPricesMinuter.token1high = token1Price;
    pairPricesMinuter.token0low = token0Price;
    pairPricesMinuter.token1low = token1Price;
  } else {
    //记录该分钟内token0 的最大最小值
    if (pairPricesMinuter.token0low.gt(token0Price)) {
      pairPricesMinuter.token0low = token0Price;
    } else if (pairPricesMinuter.token0high.lt(token0Price)) {
      pairPricesMinuter.token0high = token0Price;
    }

    //记录该分钟内token1 的最大最小值
    if (pairPricesMinuter.token1low.gt(token1Price)) {
      pairPricesMinuter.token1low = token1Price;
    } else if (pairPricesMinuter.token1high.lt(token1Price)) {
      pairPricesMinuter.token1high = token1Price;
    }
  }

  pairPricesMinuter.timestampMinuter = timeMinute;
  pairPricesMinuter.timestamp = timestamp;
  pairPricesMinuter.reserve0 = reserve0;
  pairPricesMinuter.reserve1 = reserve1;
  pairPricesMinuter.token0Price = token0Price;
  pairPricesMinuter.token1Price = token1Price;
  pairPricesMinuter.block = blockNumber;
  pairPricesMinuter.save();

  //PricesLast
  let pairPricesLast = PairPricesLast.load(pair.id);
  if (pairPricesLast == null) {
    pairPricesLast = new PairPricesLast(pair.id);
    pairPricesLast.pair = pair.id;
    pairPricesLast.token0Pricelow = token0Price;
    pairPricesLast.token1Pricelow = token1Price;
    pairPricesLast.token0Pricehigh = token0Price;
    pairPricesLast.token1Pricehigh = token1Price;

    pairPricesLast.token0PriceLowTimestamp = timestamp;
    pairPricesLast.token1PriceLowTimestamp = timestamp;
    pairPricesLast.token0PriceHighTimestamp = timestamp;
    pairPricesLast.token1PriceHighTimestamp = timestamp;
  } else {
    if (pairPricesLast.token0Pricelow.gt(token0Price)) {
      pairPricesLast.token0Pricelow = token0Price;
      pairPricesLast.token0PriceLowTimestamp = timestamp;
    } else if (pairPricesLast.token0Pricehigh.lt(token0Price)) {
      pairPricesLast.token0Pricehigh = token0Price;
      pairPricesLast.token0PriceHighTimestamp = timestamp;
    }

    if (pairPricesLast.token1Pricelow.gt(token1Price)) {
      pairPricesLast.token1Pricelow = token1Price;
      pairPricesLast.token1PriceLowTimestamp = timestamp;
    } else if (pairPricesLast.token1Pricehigh.lt(token1Price)) {
      pairPricesLast.token1Pricehigh = token1Price;
      pairPricesLast.token1PriceHighTimestamp = timestamp;
    }
  }

  pairPricesLast.timestamp = timestamp;
  pairPricesLast.reserve0 = reserve0;
  pairPricesLast.reserve1 = reserve1;
  pairPricesLast.token0Price = token0Price;
  pairPricesLast.token1Price = token1Price;
  pairPricesLast.block = blockNumber;
  pairPricesLast.save();

  //pairPricesEvery
  let timestampId = timestamp.toString() + "-" + pair.id;
  let pairPricesEvery = new PairPricesEvery(timestampId);
  pairPricesEvery.pair = pair.id;
  pairPricesEvery.timestamp = timestamp;
  pairPricesEvery.reserve0 = reserve0;
  pairPricesEvery.reserve1 = reserve1;
  pairPricesEvery.token0Price = token0Price;
  pairPricesEvery.token1Price = token1Price;
  pairPricesEvery.block = blockNumber;
  pairPricesEvery.save();
}

function pairVolumeUpdated(
  token0Volume: BigDecimal,
  token1Volume: BigDecimal,
  volumeUSD: BigDecimal,
  pair: Pair,
  event: ethereum.Event
): void {
  let timestamp = event.block.timestamp;
  let blockNumber = event.block.number;
  let timeDay = timestamp.div(ONEDAY);
  let timeHour = timestamp.div(ONEHOURS);
  let timeMinute = timestamp.div(ONEMINUTE);

  //保存总的对交易量
  pair.totalToken0Volume = pair.totalToken0Volume.plus(token0Volume);
  pair.totalToken1Volume = pair.totalToken1Volume.plus(token1Volume);
  pair.totalVolumeUsd = pair.totalVolumeUsd.plus(volumeUSD);
  pair.save();

  //pairVolumesDay
  //添加判断确保零点过后的数据会当做第二天的数据处理(因为去余数的原因)
  let showTime = timeDay.times(ONEDAY);
  let periodOfDay = BigInt.fromI32(57600);
  let interval = timestamp.minus(showTime); //因舍弃余数的时间误差
  if (interval.ge(periodOfDay)) {
    timeDay = timeDay.plus(ONE); //当相隔时间差距大于16小时时，说明到了新的一天了，该往记录为新的一天的数据
  }

  let DayId = timeDay.toString() + "-" + pair.id;
  let pairVolumeDay = PairVolumeDay.load(DayId);
  if (pairVolumeDay == null) {
    pairVolumeDay = new PairVolumeDay(DayId);
    pairVolumeDay.pair = pair.id;
    pairVolumeDay.token0Volume = ZERO_BD;
    pairVolumeDay.token1Volume = ZERO_BD;
    pairVolumeDay.volumeUsd = ZERO_BD;
  }
  pairVolumeDay.timestampDay = timeDay;
  pairVolumeDay.timestamp = timestamp;
  pairVolumeDay.token0Volume = pairVolumeDay.token0Volume.plus(token0Volume);
  pairVolumeDay.token1Volume = pairVolumeDay.token1Volume.plus(token1Volume);
  pairVolumeDay.volumeUsd = pairVolumeDay.volumeUsd.plus(volumeUSD);
  pairVolumeDay.block = blockNumber;
  pairVolumeDay.save();

  //VolumeHour
  let HourId = timeHour.toString() + "-" + pair.id;
  let pairVolumeHour = PairVolumeHour.load(HourId);
  if (pairVolumeHour == null) {
    pairVolumeHour = new PairVolumeHour(HourId);
    pairVolumeHour.pair = pair.id;
    pairVolumeHour.token0Volume = ZERO_BD;
    pairVolumeHour.token1Volume = ZERO_BD;
    pairVolumeHour.volumeUsd = ZERO_BD;
  }
  pairVolumeHour.timestampHour = timeHour;
  pairVolumeHour.timestamp = timestamp;
  pairVolumeHour.token0Volume = pairVolumeHour.token0Volume.plus(token0Volume);
  pairVolumeHour.token1Volume = pairVolumeHour.token1Volume.plus(token1Volume);
  pairVolumeHour.volumeUsd = pairVolumeHour.volumeUsd.plus(volumeUSD);
  pairVolumeHour.block = blockNumber;
  pairVolumeHour.save();

  //VolumeMinute
  let MinuteId = timeMinute.toString() + "-" + pair.id;
  let pairVolumeMinute = PairVolumeMinuter.load(MinuteId);
  if (pairVolumeMinute == null) {
    pairVolumeMinute = new PairVolumeMinuter(MinuteId);
    pairVolumeMinute.pair = pair.id;
    pairVolumeMinute.token0Volume = ZERO_BD;
    pairVolumeMinute.token1Volume = ZERO_BD;
    pairVolumeMinute.volumeUsd = ZERO_BD;
  }
  pairVolumeMinute.timestampMinuter = timeMinute;
  pairVolumeMinute.timestamp = timestamp;
  pairVolumeMinute.token0Volume = pairVolumeMinute.token0Volume.plus(token0Volume);
  pairVolumeMinute.token1Volume = pairVolumeMinute.token1Volume.plus(token1Volume);
  pairVolumeMinute.volumeUsd = pairVolumeMinute.volumeUsd.plus(volumeUSD);
  pairVolumeMinute.block = blockNumber;
  pairVolumeMinute.save();
}

function TokenVolumeUpdated(
  token0Volume: BigDecimal,
  token1Volume: BigDecimal,
  token0VolumeUsd: BigDecimal,
  token1VolumeUsd: BigDecimal,
  pair: Pair,
  event: ethereum.Event
): void {
  let timestamp = event.block.timestamp;
  let blockNumber = event.block.number;
  let timeHour = timestamp.div(ONEHOURS);
  let timeDay = timestamp.div(ONEDAY);

  let token0 = Token.load(pair.token0);
  let token1 = Token.load(pair.token1);

  //token0 VolumeHour
  let token0HourId = timeHour.toString() + "-" + token0.id;
  let token0VolumeHour = TokenVolumeHour.load(token0HourId);
  if (token0VolumeHour == null) {
    token0VolumeHour = new TokenVolumeHour(token0HourId);
    token0VolumeHour.token = pair.token0;
    token0VolumeHour.volume = ZERO_BD;
    token0VolumeHour.volumeUsd = ZERO_BD;
  }
  token0VolumeHour.timestampHour = timeHour;
  token0VolumeHour.timestamp = timestamp;
  token0VolumeHour.volume = token0Volume;
  token0VolumeHour.volumeUsd = token0VolumeUsd;
  token0VolumeHour.block = blockNumber;
  token0VolumeHour.save();

  //token0 VolumeHour
  let token1HourId = timeHour.toString() + "-" + token1.id;
  let token1VolumeHour = TokenVolumeHour.load(token1HourId);
  if (token1VolumeHour == null) {
    token1VolumeHour = new TokenVolumeHour(token1HourId);
    token1VolumeHour.token = pair.token1;
    token1VolumeHour.volume = ZERO_BD;
    token1VolumeHour.volumeUsd = ZERO_BD;
  }
  token1VolumeHour.timestampHour = timeHour;
  token1VolumeHour.timestamp = timestamp;
  token1VolumeHour.volume = token1Volume;
  token1VolumeHour.volumeUsd = token1VolumeUsd;
  token1VolumeHour.block = blockNumber;
  token1VolumeHour.save();

  //TotalVolumesHour
  let HourId = timeHour.toString() + "-USD";
  let totalVolumeInSymbolByHour = TotalVolumeInSymbolByHour.load(HourId);
  if (totalVolumeInSymbolByHour == null) {
    totalVolumeInSymbolByHour = new TotalVolumeInSymbolByHour(HourId);
    totalVolumeInSymbolByHour.symbol = "USD";
    totalVolumeInSymbolByHour.totalValue = ZERO_BD;
  }
  totalVolumeInSymbolByHour.timestampHour = timeHour;
  totalVolumeInSymbolByHour.timestamp = timestamp;
  totalVolumeInSymbolByHour.totalValue = totalVolumeInSymbolByHour.totalValue
    .plus(token0VolumeUsd)
    .plus(token1VolumeUsd);
  totalVolumeInSymbolByHour.block = blockNumber;
  totalVolumeInSymbolByHour.save();

  //TotalVolumesDay
  //添加判断确保零点过后的数据会当做第二天的数据处理(因为去余数的原因)
  let showTime = timeDay.times(ONEDAY);
  let periodOfDay = BigInt.fromI32(57600);
  let interval = timestamp.minus(showTime); //因舍弃余数的时间误差
  if (interval.ge(periodOfDay)) {
    timeDay = timeDay.plus(ONE); //当相隔时间差距大于16小时时，说明到了新的一天了，该往记录为新的一天的数据
  }

  let DayId = timeDay.toString() + "-USD";
  let totalVolumeInSymbolByDay = TotalVolumeInSymbolByDay.load(DayId);
  if (totalVolumeInSymbolByDay == null) {
    totalVolumeInSymbolByDay = new TotalVolumeInSymbolByDay(DayId);
    totalVolumeInSymbolByDay.symbol = "USD";
    totalVolumeInSymbolByDay.totalValue = ZERO_BD;
  }
  totalVolumeInSymbolByDay.timestampDay = timeDay;
  totalVolumeInSymbolByDay.timestamp = timestamp;
  totalVolumeInSymbolByDay.totalValue = totalVolumeInSymbolByDay.totalValue
    .plus(token0VolumeUsd)
    .plus(token1VolumeUsd);
  totalVolumeInSymbolByDay.block = blockNumber;
  totalVolumeInSymbolByDay.save();
}

function isCompleteMint(mintId: string): boolean {
  return Mint.load(mintId).sender !== null;
}

export function handleTransfer(event: TransferEvent): void {
  if (
    event.params.to == ADDRESS_ZERO &&
    event.params.value.equals(BigInt.fromI32(1000))
  ) {
    return;
  }

  let transactionHash = event.transaction.hash.toHexString();
  let from = event.params.from;
  let to = event.params.to;

  // get pair
  let pair = Pair.load(event.address.toHexString());
  let value = convertTokenToDecimal(event.params.value, BI_18);

  // get or create transaction
  let transaction = Transaction.load(transactionHash);
  if (transaction === null) {
    transaction = new Transaction(transactionHash);
    transaction.blockNumber = event.block.number;
    transaction.timestamp = event.block.timestamp;
    transaction.mints = [];
    transaction.burns = [];
    transaction.swaps = [];
  }

  // mints
  let mints = transaction.mints;
  if (from == ADDRESS_ZERO && event.params.to != receive_fee_address) {
    if (mints.length === 0 || isCompleteMint(mints[mints.length - 1])) {
      let mint = new Mint(
        event.transaction.hash
          .toHexString()
          .concat("-")
          .concat(BigInt.fromI32(mints.length).toString())
      );
      mint.transaction = transaction.id;
      mint.pair = pair.id;
      mint.to = to;
      mint.liquidity = value;
      mint.timestamp = transaction.timestamp;
      mint.transaction = transaction.id;
      mint.save();

      // update mints in transaction
      transaction.mints = mints.concat([mint.id]);
      transaction.save();

      //记录用户的lptoken数量
      let userLpTokenAvailable = UserLpTokenAvailable.load(
        mint.to.toHexString().concat("-").concat(pair.id)
      );

      if (userLpTokenAvailable == null) {
        userLpTokenAvailable = new UserLpTokenAvailable(
          mint.to.toHexString().concat("-").concat(pair.id)
        );

        userLpTokenAvailable.user = mint.to;
        userLpTokenAvailable.pair = pair.id;
        userLpTokenAvailable.amount_BI = ZERO;
        userLpTokenAvailable.amount_BD = ZERO_BD;
      }

      userLpTokenAvailable.amount_BI = userLpTokenAvailable.amount_BI.plus(
        event.params.value
      );
      userLpTokenAvailable.amount_BD = convertTokenToDecimal(
        userLpTokenAvailable.amount_BI,
        BI_18
      );
      userLpTokenAvailable.save();
    }

    // update the pair supply
    pair.supply = pair.supply.plus(value);
    pair.save();
  }

  //转账到fee地址上也算作burn的一种,这里记录的是手续费部分
  if (from == ADDRESS_ZERO && to == receive_fee_address) {
    let burns = transaction.burns;
    let burn = new Burn(
      event.transaction.hash
        .toHexString()
        .concat("-")
        .concat(BigInt.fromI32(burns.length).toString())
    );
    burn.transaction = transaction.id;
    burn.pair = pair.id;
    burn.liquidity = value;
    burn.timestamp = transaction.timestamp;
    burn.to = event.params.to;
    burn.sender = event.params.from;
    burn.beComplete = true;
    burn.transaction = transaction.id;
    burn.feeTo = to;
    burn.feeLiquidity = value;
    burn.save();

    //将手续费的burn加到数组头
    burns.push(burn.id);
    transaction.burns = burns;
    transaction.save();

    // update the pair supply
    pair.supply = pair.supply.plus(value);
    pair.save();
  }

  // burn
  if (event.params.to == ADDRESS_ZERO && event.params.from.toHexString() == pair.id) {
    // this is a new instance of a logical burn
    let burns = transaction.burns;
    let burn = new Burn(
      event.transaction.hash
        .toHexString()
        .concat("-")
        .concat(BigInt.fromI32(burns.length).toString())
    );
    burn.transaction = transaction.id;
    burn.beComplete = false;
    burn.pair = pair.id;
    burn.to = to;
    burn.liquidity = value;
    burn.sender = event.transaction.from;
    burn.transaction = transaction.id;
    burn.timestamp = transaction.timestamp;
    burn.save();

    burns.push(burn.id);
    transaction.burns = burns;
    transaction.save();

    //记录用户的lptoken数量
    let userLpId = burn.sender.toHexString().concat("-").concat(pair.id);
    let userLpTokenAvailable = UserLpTokenAvailable.load(userLpId);

    if (userLpTokenAvailable != null) {
      userLpTokenAvailable.amount_BI = userLpTokenAvailable.amount_BI.minus(
        event.params.value
      );
      userLpTokenAvailable.amount_BD = convertTokenToDecimal(
        userLpTokenAvailable.amount_BI,
        BI_18
      );
      if (userLpTokenAvailable.amount_BI == ZERO) {
        store.remove("UserLpTokenAvailable", userLpId);
      } else {
        userLpTokenAvailable.save();
      }
    } else {
      log.debug("user Lp token as zero", [pair.id]);
    }

    // update the pair supply
    pair.supply = pair.supply.minus(value);
    pair.save();
  }
  transaction.save();
}

export function handleMint(event: MintEvent): void {
  let transaction = Transaction.load(event.transaction.hash.toHexString());
  if (transaction === null || transaction.mints.length == 0) {
    return;
  }

  let mints = transaction.mints;
  let mint = Mint.load(mints[mints.length - 1]);
  if (mint == null) {
    return;
  }

  let pair = Pair.load(event.address.toHexString());
  let swapPairFeeInfoByLast = SwapPairFeeInfoByLast.load(event.address.toHex());

  let token0 = Token.load(pair.token0);
  let token1 = Token.load(pair.token1);

  let token0Amount = convertTokenToDecimal(event.params.amount0, token0.decimals);
  let token1Amount = convertTokenToDecimal(event.params.amount1, token1.decimals);

  mint.sender = event.params.sender;
  mint.amount0 = token0Amount as BigDecimal;
  mint.amount1 = token1Amount as BigDecimal;
  mint.token0Price = swapPairFeeInfoByLast.lastToken0Price;
  mint.token1Price = swapPairFeeInfoByLast.lastToken1Price;
  mint.save();
}

export function handleBurn(event: BurnEvent): void {
  let transaction = Transaction.load(event.transaction.hash.toHexString());
  if (transaction === null) {
    return;
  }

  let burns = transaction.burns;
  let burn = Burn.load(burns[burns.length - 1]);

  let pair = Pair.load(event.address.toHex());
  let swapPairFeeInfoByLast = SwapPairFeeInfoByLast.load(event.address.toHex());

  let token0 = Token.load(pair.token0);
  let token1 = Token.load(pair.token1);
  let token0Amount = convertTokenToDecimal(event.params.amount0, token0.decimals);
  let token1Amount = convertTokenToDecimal(event.params.amount1, token1.decimals);

  //这里不能替换掉sender,会导致合约地址覆盖掉用户地址，出现这种情况是因为burn和 mint 的event 不一样，具体情况可以查看一个transfer 的event调用顺序
  //burn.sender = event.params.sender;
  burn.amount0 = token0Amount as BigDecimal;
  burn.amount1 = token1Amount as BigDecimal;
  burn.token0Price = swapPairFeeInfoByLast.lastToken0Price;
  burn.token1Price = swapPairFeeInfoByLast.lastToken1Price;
  burn.save();
}

export function handleFreeze(event: FreezeEvent): void {
  let pair = Pair.load(event.address.toHex());
  if (pair === null) {
    return;
  }

  let freezePair = FreezePair.load(event.address.toHex());
  if (freezePair === null) {
    freezePair = new FreezePair(event.address.toHex());
    freezePair.pairAddress = event.address;
    freezePair.token0 = pair.token0;
    freezePair.token1 = pair.token1;
  }

  let token0 = Token.load(pair.token0);
  let token1 = Token.load(pair.token1);
  let token0UsdPrice = getTokenUSDPrice(token0 as Token);
  let token1UsdPrice = getTokenUSDPrice(token1 as Token);
  if (token0UsdPrice == ZERO_BD) {
    let ethPrice = getTokenEthPrice(token0 as Token);
    let eth = WhiteListToken.load(eth_address_str);
    token0UsdPrice = ethPrice.times(eth.usdPrice);
  }
  if (token1UsdPrice == ZERO_BD) {
    let ethPrice = getTokenEthPrice(token1 as Token);
    let eth = WhiteListToken.load(eth_address_str);
    token1UsdPrice = ethPrice.times(eth.usdPrice);
  }
  freezePair.token0UsdPrice = token0UsdPrice;
  freezePair.token1UsdPrice = token1UsdPrice;
  freezePair.freezer = event.params.freezer;
  freezePair.timestamp = event.block.timestamp;
  freezePair.block = event.block.number;
  freezePair.save();
}
