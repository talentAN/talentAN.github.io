import React, { useState, useEffect, useMemo } from 'react';
import { Button, Card, Tooltip, message } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import { navigate } from 'gatsby';
import moment from 'moment';
import patternData from '@root/contract-record/find-pattern.json';
import { getFutureTicker, getTradeUrl } from '@root/src/container/market';
import ResultList from './backtest/_ResultList';
import {
  BREWING_PATTERN_ENUM,
  getBrewingPattern,
  inferBrewingPatternKey,
} from './_brewingPatterns';
import * as s from './backtest/backtest.module.less';

const cx = (...names) => names.filter(Boolean).join(' ');

const EX_FILTERS = [
  { key: 'all', label: '全部' },
  { key: 'bitget', label: 'Bitget' },
  { key: 'binance', label: 'Binance' },
];

const normalizeExchange = exchange => {
  const ex = String(exchange || 'bitget').toLowerCase();
  if (ex.startsWith('binance')) return 'binance';
  return 'bitget';
};

const loadRows = () => {
  const raw = Array.isArray(patternData?.data)
    ? patternData.data
    : Array.isArray(patternData?.tabs)
      ? patternData.tabs.flatMap(tab =>
          (tab.data || []).map(row => ({
            ...row,
            note: [tab.label, row.reason, row.note].filter(Boolean).join(' · '),
          }))
        )
      : [];

  return raw.map((row, index) => {
    const exchange = normalizeExchange(row.exchange);
    const symbol = String(row.symbol || '').toUpperCase();
    const name = inferBrewingPatternKey(row);
    return {
      ...row,
      key: `${exchange}:${symbol}:${index}`,
      exchange,
      symbol,
      name,
      keyDate: row.keyDate || '',
      addDate: row.addDate || '',
      note: row.note || '',
      followUp: row.followUp || '',
    };
  });
};

const FindPattern = () => {
  const [rows, setRows] = useState(loadRows);
  const [newSymbol, setNewSymbol] = useState('');
  const [newKeyDate, setNewKeyDate] = useState('');
  const [newExchange, setNewExchange] = useState('bitget');
  const [newName, setNewName] = useState('gentleRise');
  const [exFilter, setExFilter] = useState('all');
  const [nameFilter, setNameFilter] = useState('all');
  const [keyword, setKeyword] = useState('');
  const [prices, setPrices] = useState({});

  useEffect(() => {
    let cancelled = false;
    const fetchPrices = async () => {
      const next = { ...prices };
      for (const row of rows) {
        const priceKey = `${row.exchange}:${row.symbol}`;
        if (!row.symbol || next[priceKey] != null) continue;
        try {
          const tickerData = await getFutureTicker(row.symbol, row.exchange);
          if (tickerData?.lastPr) {
            next[priceKey] = parseFloat(tickerData.lastPr).toFixed(6);
          }
        } catch (e) {
          console.error(`获取 ${row.exchange} ${row.symbol} 价格失败:`, e);
        }
      }
      if (!cancelled) setPrices(next);
    };
    fetchPrices();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows]);

  const displayRows = useMemo(() => {
    const query = keyword.trim().toUpperCase();
    return rows.filter(row => {
      if (exFilter !== 'all' && row.exchange !== exFilter) return false;
      if (nameFilter !== 'all' && row.name !== nameFilter) return false;
      if (query && !row.symbol.includes(query)) return false;
      return true;
    });
  }, [rows, exFilter, nameFilter, keyword]);

  const columns = [
    {
      key: 'symbol',
      title: '币对',
      width: 130,
      sortBy: row => row.symbol,
      render: row => (
        <>
          <a
            className={s.symbolLink}
            href={getTradeUrl(row.symbol, row.exchange)}
            target="_blank"
            rel="noopener noreferrer"
          >
            {row.symbol.replace(/USDT$/, '')}
          </a>
          <span className={s.exchangeTag}>{row.exchange === 'binance' ? 'BN' : 'BG'}</span>
        </>
      ),
    },
    {
      key: 'keyDate',
      title: '关键日期',
      width: 110,
      sortBy: row => row.keyDate,
      render: row => <span className={s.muted}>{row.keyDate || '-'}</span>,
    },
    {
      key: 'addDate',
      title: '添加日期',
      width: 110,
      sortBy: row => row.addDate,
      render: row => <span className={s.muted}>{row.addDate || '-'}</span>,
    },
    {
      key: 'name',
      title: '命名',
      width: 150,
      sortBy: row => getBrewingPattern(row).label,
      render: row => {
        const pattern = getBrewingPattern(row);
        return (
          <a
            className={s.symbolLink}
            href={pattern.path}
            onClick={e => {
              e.preventDefault();
              navigate(pattern.path);
            }}
          >
            {pattern.label}
          </a>
        );
      },
    },
    {
      key: 'note',
      title: '描述',
      width: 320,
      sortBy: row => row.note,
      render: row => {
        const text = row.note || '-';
        return (
          <Tooltip title={row.note || null} placement="topLeft" overlayStyle={{ maxWidth: 480 }}>
            <span>{text}</span>
          </Tooltip>
        );
      },
    },
    {
      key: 'followUp',
      title: '后续观察',
      width: 200,
      sortBy: row => row.followUp,
      render: row => {
        const text = row.followUp || '-';
        return (
          <Tooltip title={row.followUp || null} placement="topLeft" overlayStyle={{ maxWidth: 360 }}>
            <span>{text}</span>
          </Tooltip>
        );
      },
    },
    {
      key: 'latestPrice',
      title: '最新价',
      width: 110,
      align: 'right',
      render: row => prices[`${row.exchange}:${row.symbol}`] || '-',
    },
  ];

  const handleAddRecord = () => {
    if (!newSymbol.trim()) {
      message.warning('请输入币对名称');
      return;
    }
    const symbol = newSymbol.trim().toUpperCase();
    const exchange = normalizeExchange(newExchange);
    const name = inferBrewingPatternKey({ name: newName });
    const newRecord = {
      key: `${exchange}:${symbol}:${Date.now()}`,
      exchange,
      symbol,
      name,
      keyDate: newKeyDate.trim() || moment().format('YYYY-MM-DD'),
      addDate: moment().format('YYYY-MM-DD'),
      note: '',
      followUp: '',
    };
    setRows(prev => [newRecord, ...prev]);
    setNewSymbol('');
    setNewKeyDate('');
    message.success('添加成功');
  };

  const handleExport = () => {
    const data = rows.map(({ key, ...rest }) => ({
      exchange: rest.exchange,
      symbol: rest.symbol,
      name: rest.name,
      keyDate: rest.keyDate || '',
      addDate: rest.addDate || '',
      note: rest.note || '',
      followUp: rest.followUp || '',
      ...(rest.achieved ? { achieved: true } : {}),
    }));
    const text = JSON.stringify({ data }, null, 2);
    navigator.clipboard
      .writeText(text)
      .then(() => message.success('已复制到剪贴板，请手动更新 contract-record/find-pattern.json'))
      .catch(() => message.error('复制失败'));
  };

  return (
    <Card bodyStyle={{ padding: '10px 12px 12px' }}>
      <div className={s.panel}>
        <div className={s.metaRow}>
          <span className={s.ruleText}>
            酝酿池：命名对应回测主 tab，点击可跳转；描述为人工备注
          </span>
          <div className={s.actions}>
            {displayRows.length > 0 && <span className={s.countBadge}>共 {displayRows.length} 条</span>}
            <Button size="small" onClick={handleExport}>
              导出数据
            </Button>
          </div>
        </div>

        <div className={s.filterRow}>
          {EX_FILTERS.map(item => (
            <span
              key={item.key}
              onClick={() => setExFilter(item.key)}
              className={cx(s.filterChip, exFilter === item.key && s.filterChipActive)}
            >
              {item.label}
            </span>
          ))}
          <span className={s.muted}>|</span>
          <span
            onClick={() => setNameFilter('all')}
            className={cx(s.filterChip, nameFilter === 'all' && s.filterChipActive)}
          >
            命名全部
          </span>
          {BREWING_PATTERN_ENUM.map(item => (
            <span
              key={item.key}
              onClick={() => setNameFilter(item.key)}
              className={cx(s.filterChip, nameFilter === item.key && s.filterChipActive)}
              title={item.label}
            >
              {item.label.replace(/^data-|^回测\d+-/, '')}
            </span>
          ))}
          <input
            className={s.search}
            placeholder="筛选币对"
            value={keyword}
            onChange={e => setKeyword(e.target.value)}
          />
        </div>

        <div className={s.filterRow}>
          <select
            className={s.search}
            value={newExchange}
            onChange={e => setNewExchange(e.target.value)}
            style={{ width: 100 }}
            title="新增记录所属交易所"
          >
            <option value="bitget">Bitget</option>
            <option value="binance">Binance</option>
          </select>
          <select
            className={s.search}
            value={newName}
            onChange={e => setNewName(e.target.value)}
            style={{ width: 160 }}
            title="命名（对应回测 tab）"
          >
            {BREWING_PATTERN_ENUM.map(item => (
              <option key={item.key} value={item.key}>
                {item.label}
              </option>
            ))}
          </select>
          <input
            className={s.search}
            placeholder="币对（如 BTCUSDT）"
            value={newSymbol}
            onChange={e => setNewSymbol(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleAddRecord()}
            style={{ width: 150 }}
          />
          <input
            className={s.search}
            placeholder="关键日期"
            value={newKeyDate}
            onChange={e => setNewKeyDate(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleAddRecord()}
            style={{ width: 130 }}
          />
          <Button size="small" type="primary" icon={<PlusOutlined />} onClick={handleAddRecord}>
            添加
          </Button>
        </div>

        <ResultList
          key={`${exFilter}-${nameFilter}`}
          columns={columns}
          rows={displayRows}
          empty="暂无记录"
          defaultSort={{ key: 'addDate', dir: 'desc' }}
        />
      </div>
    </Card>
  );
};

export default FindPattern;
