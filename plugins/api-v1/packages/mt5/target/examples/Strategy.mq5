#property strict
#property description "Product SDK lifecycle example; contains no order or strategy logic."
#include <Product/Results.mqh>
#include <Product/Trade.mqh>

// Compile this example to check SDK wiring. It never submits orders.
// A real translation must implement the frozen SVL source and its source map.
int OnInit()
  {
   if(!ProductExecutionAllowed()) return INIT_FAILED;
   if(!ProductTraceOpen()) return INIT_FAILED;
   if(!EventSetTimer(5))
     {
      ProductTraceClose();
      return INIT_FAILED;
     }
   ProductEmit("lifecycle","platform.expert",ProductQuote("initialized"));
   return INIT_SUCCEEDED;
  }

void OnTick()
  {
   if(ProductTestCanceled() || !ProductExecutionAllowed()) return;
   ProductEquity();
   ProductRisk.Refresh();
   // Translate actual tick/bar rules here, with explicit data readiness.
  }

void OnTimer()
  {
   if(ProductTestCanceled()) return;
   if(!ProductExecutionAllowed()) { ExpertRemove(); return; }
   ProductEmit("lifecycle","platform.expert",ProductQuote("heartbeat"));
   // A heartbeat confirms the callback ran; it is not a strategy decision.
  }

void OnTradeTransaction(const MqlTradeTransaction &tx,
                        const MqlTradeRequest &request,
                        const MqlTradeResult &result)
  {
   ProductTransaction(tx,request,result);
   // Reconcile real tickets with owned pending intents before updating state.
  }

double OnTester()
  {
   return ProductTesterResult();
  }

void OnDeinit(const int reason)
  {
   EventKillTimer();
   ProductEmit("lifecycle","platform.expert",ProductQuote("deinitialized"));
   ProductTraceClose();
  }
