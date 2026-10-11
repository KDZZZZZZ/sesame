#property strict
#property description "Read-only frozen Agent input transport example; no strategy or trading."
#include <Product/Results.mqh>
#include <Product/FrozenInputs.mqh>
// Pin these at translation time. Never use a live bridge token or bearer here.
input string TimelineDigest="";
input long ReplayUtcMs=0;
bool Delivered=false;
int OnInit()
  {
   if(!MQLInfoInteger(MQL_TESTER) || !ProductTraceOpen()) return INIT_FAILED;
   if(!ProductFrozenOpen(TimelineDigest)) { ProductTraceClose(); return INIT_FAILED; }
   return INIT_SUCCEEDED;
  }
void OnTick()
  {
   ProductEquity();
   if(Delivered) return;
   string event_json; int next;
   while((next=ProductFrozenNext(ReplayUtcMs,event_json))==1)
     {
      // This is observed input transport only. A source-specific translator must
      // parse and validate event_json, run SVL rules and capture real node outputs.
      ProductEmit("frozen_input","svl.input",event_json);
     }
   if(next<0) ProductEmit("runtime_error","svl.input",ProductQuote("Invalid UTC replay clock"));
   Delivered=true;
  }
double OnTester() { return ProductTesterResult(); }
void OnDeinit(const int reason) { ProductTraceClose(); }
