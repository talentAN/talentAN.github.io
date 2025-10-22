import React from 'react';
import { 
    Button, 
  } from 'antd';

export const Operation = ({record})=> <div style={{display:'flex', alignItems:'center'}}>

<Button 
  type="link" 
  onClick={() => {
    window.open(`https://sjk2oahoo1.com/zh-CN/futures/usdt/${record.symbol}`, '_blank');
  }}
>
  sjk
</Button>
<Button 
  type="link" 
  onClick={() => {
    window.open(`https://www.bitget.cloud/zh-CN/futures/usdt/${record.symbol}`, '_blank');
  }}
>
  cn
</Button>
<Button 
  type="link" 
  onClick={() => {
    window.open(`https://www.bitget.com/zh-CN/futures/usdt/${record.symbol}`, '_blank');
  }}
>
  com
</Button>
</div>