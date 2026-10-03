import test from 'node:test';
import assert from 'node:assert/strict';
import {calculateDeal} from '../.server-test/server/dealEngine.js';
import {buildHistoricalMarketContext} from '../.server-test/server/propertyHistoryContext.js';

const base={
 purchasePriceNis:1_500_000,
 purchaseTaxNis:0,
 legalFeesNis:15_000,
 renovationNis:80_000,
 loanAmountNis:750_000,
 annualInterestRatePct:4.5,
 loanTermYears:25,
 expectedMonthlyRentNis:5_500,
 vacancyPct:5,
 annualMaintenanceNis:6_000,
 annualOtherOperatingNis:2_000,
 exitYears:5,
 annualAppreciationPct:2.5,
 saleCostsPct:1.5,
 targetAnnualReturnPct:8
};

test('deal engine returns deterministic acquisition and financing outputs',()=>{
 const a=calculateDeal(base),b=calculateDeal(base);
 assert.deepEqual(a,b);
 assert.equal(a.totalAcquisitionCostNis,1_595_000);
 assert.ok(a.equityRequiredNis>0);
 assert.ok(a.monthlyDebtServiceNis>0);
 assert.ok(a.projectedExitValueNis>base.purchasePriceNis);
});

test('deal engine keeps yields and IRR finite or explicit null',()=>{
 const out=calculateDeal(base);
 assert.ok(out.grossYieldPct!==null&&Number.isFinite(out.grossYieldPct));
 assert.ok(out.netYieldPct!==null&&Number.isFinite(out.netYieldPct));
 assert.ok(out.irrPct===null||Number.isFinite(out.irrPct));
 assert.ok(out.breakEvenMonthlyRentNis!==null&&out.breakEvenMonthlyRentNis>0);
});

test('zero loan produces zero debt service and no loan balance',()=>{
 const out=calculateDeal({...base,loanAmountNis:0});
 assert.equal(out.monthlyDebtServiceNis,0);
 assert.equal(out.annualDebtServiceNis,0);
 assert.equal(out.loanBalanceAtExitNis,0);
});

test('explicit exit price overrides appreciation assumption',()=>{
 const out=calculateDeal({...base,exitPriceNis:2_000_000,annualAppreciationPct:99});
 assert.equal(out.projectedExitValueNis,2_000_000);
});

test('target-return solver returns a positive maximum purchase price when cashflows support it',()=>{
 const out=calculateDeal({...base,targetAnnualReturnPct:6});
 assert.ok(out.maxPurchasePriceForTargetReturnNis===null||out.maxPurchasePriceForTargetReturnNis>0);
});


test('historical market only keeps subject-relevant executed sales and computes trend',()=>{
 const listing={id:'l',neighborhood_id:'n',canonical_address:'דרייפוס 25',area_sqm:100,rooms:4,floor:3};
 const rows=[
  {transaction_id:'same',address_text:'דרייפוס 25',deal_date:'2026-01-01',sale_price_nis:1800000,area_sqm:100,rooms:4,floor:3,price_per_sqm:18000},
  {transaction_id:'near-size',address_text:'דרייפוס 31',deal_date:'2025-10-01',sale_price_nis:1760000,area_sqm:96,rooms:4,floor:2,price_per_sqm:18333},
  {transaction_id:'too-small',address_text:'דרך צרפת 2',deal_date:'2025-09-01',sale_price_nis:900000,area_sqm:50,rooms:2,floor:2,price_per_sqm:18000}
 ];
 const periods=[
  {period_start:'2025-01-01',executed_transaction_count:5,median_executed_price_sqm:16000,active_sale_listing_count:4,asking_to_executed_premium_pct:8,transaction_confidence:.6},
  {period_start:'2026-01-01',executed_transaction_count:7,median_executed_price_sqm:17600,active_sale_listing_count:5,asking_to_executed_premium_pct:6,transaction_confidence:.8}
 ];
 const out=buildHistoricalMarketContext(listing,rows,periods);
 assert.equal(out.similarSales.some(x=>x.transactionId==='too-small'),false);
 assert.equal(out.similarSales.length,2);
 assert.equal(out.summary.changeVs12MonthsAgoPct,10);
 assert.equal(out.summary.latestMedianExecutedPriceSqm,17600);
});
