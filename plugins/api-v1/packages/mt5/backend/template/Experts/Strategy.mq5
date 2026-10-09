#property strict
#property version "2.00"
// Platform-owned lifecycle. Customize Include/Strategy/*.mqh instead.
#include <Strategy/Expert.mqh>
#include <Strategy/Signal.mqh>
#include <Strategy/Money.mqh>
#include <Strategy/Trailing.mqh>
#include <Product/Results.mqh>

CStrategyExpert Expert;
CStrategySignal *Signal;
int OnInit()
  {
   if(!MQLInfoInteger(MQL_TESTER)) { Print("This managed SDK currently supports Tester only."); return INIT_FAILED; }
   if(!ProductTraceOpen() || !Expert.Init(_Symbol,_Period,true,InpMagic)) return INIT_FAILED;
   Signal=new CStrategySignal;
   if(!Expert.InitSignal(Signal)) return INIT_FAILED;
   CStrategyMoney *money=new CStrategyMoney;
   if(!Expert.InitMoney(money)) return INIT_FAILED;
   CStrategyTrailing *trailing=new CStrategyTrailing;
   if(!Expert.InitTrailing(trailing)) return INIT_FAILED;
   if(!Signal.Configure() || !money.Configure() || !trailing.Configure() || !Expert.Configure())
     { Print("Complete the strategy modules and validate their configuration before testing."); return INIT_PARAMETERS_INCORRECT; }
   if(!Expert.ValidationSettings() || !Expert.InitIndicators()) return INIT_FAILED;
   EventSetTimer(1);
   ProductEmit("lifecycle","platform.expert","\"initialized\"");
   return INIT_SUCCEEDED;
  }
void OnTick() { if(ProductTestCanceled()) return; ProductEquity(); Expert.Observe(); if(Signal!=NULL) Signal.Advance(); Expert.OnTick(); if(Signal!=NULL) Signal.ConsumeSignal(); }
void OnTimer() { if(!ProductTestCanceled()) { Expert.Observe(); Expert.OnTimer(); } }
void OnTrade() { Expert.Observe(); Expert.OnTrade(); }
void OnTradeTransaction(const MqlTradeTransaction &tx,const MqlTradeRequest &request,const MqlTradeResult &result)
  { ProductTransaction(tx,request,result); Expert.OnTransaction(tx,request,result); }
double OnTester() { return ProductTesterResult(); }
void OnDeinit(const int reason)
  {
   EventKillTimer(); Expert.Deinit(); Signal=NULL;
   ProductEmit("lifecycle","platform.expert",IntegerToString(reason)); ProductTraceClose();
  }
