import test from 'node:test';
import assert from 'node:assert/strict';
import {calculateDeal} from '../.server-test/server/dealEngine.js';

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
