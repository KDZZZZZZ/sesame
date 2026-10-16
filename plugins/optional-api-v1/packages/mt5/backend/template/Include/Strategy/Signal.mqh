#ifndef STRATEGY_SIGNAL_MQH
#define STRATEGY_SIGNAL_MQH
#include <Expert/ExpertSignal.mqh>
// Agent-owned opportunity state, indicators and entry/exit intent.
// Advance observes the market; consuming an intent does NOT confirm a fill.
class CStrategySignal : public CExpertSignal
  {
public:
   bool Configure() { return false; } // Implement and validate strategy inputs.
   void Advance() {}
   void ConsumeSignal() {}
   virtual int LongCondition() { return 0; }
   virtual int ShortCondition() { return 0; }
  };
#endif
