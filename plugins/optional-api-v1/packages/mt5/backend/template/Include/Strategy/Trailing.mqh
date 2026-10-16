#ifndef STRATEGY_TRAILING_MQH
#define STRATEGY_TRAILING_MQH
#include <Expert/Trailing/TrailingNone.mqh>
// Agent-owned protection policy. Keeping CTrailingNone requires an explicit
// disabled declaration and Configure() returning true, with a reason.
class CStrategyTrailing : public CTrailingNone
  {
public:
   bool Configure() { return false; }
  };
#endif
