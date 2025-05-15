import React, { useState, useEffect } from 'react';
import { toast } from 'react-hot-toast';
import { Search, Edit } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { formatAmount } from '../../lib/format';

interface BusinessPartner {
  id: string;
  code: string;
  name: string;
}

interface Transaction {
  id: string;
  voucher_no: string;
  transaction_date: string;
  description: string;
  status: string;
  gl_transactions: {
    id: string;
    debit: number;
    credit: number;
    debit_doc_currency: number;
    credit_doc_currency: number;
    exchange_rate: number;
    currency_id: string;
    purchase_rate: number | null;
    sales_rate: number | null;
    account: {
      id: string;
      name: string;
    };
  }[];
}

interface TransactionType {
  type_id: string;
  transaction_type_code: string;
  description: string;
}

export default function BankTransfer() {
  const navigate = useNavigate();
  const [businessPartners, setBusinessPartners] = useState<BusinessPartner[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [customer, setCustomer] = useState<BusinessPartner | null>(null);
  const [supplier, setSupplier] = useState<BusinessPartner | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [transactionTypeId, setTransactionTypeId] = useState<string | null>(null);
  const [commissionAccountId, setCommissionAccountId] = useState<string | null>(null);
  const [baseCurrencyId, setBaseCurrencyId] = useState<string | null>(null);
  const [currencies, setCurrencies] = useState<any[]>([]);
  const [transactionTypes, setTransactionTypes] = useState<TransactionType[]>([]);
  const [limit] = useState(20);
  const [searchTerm, setSearchTerm] = useState("");

  // Form state
  const [formData, setFormData] = useState({
    date: new Date().toISOString().split('T')[0],
    narration: '',
    amount: '',
    sellingRate: '',
    purchaseRate: '',
    commission: '0',
    type: ''
  });

  // Calculate commission when values change
  useEffect(() => {

    const amount = parseFloat(formData.amount);
    const sellingRate = parseFloat(formData.sellingRate);
    const purchaseRate = parseFloat(formData.purchaseRate);

    if (!isNaN(amount) && !isNaN(sellingRate) && !isNaN(purchaseRate)) {
      // Calculate commission based on rates per 100K
      const commission = (amount / 100000) * (sellingRate - purchaseRate);
      setFormData(prev => ({ ...prev, commission: commission.toFixed(2) }));
    }
  }, [formData.amount, formData.sellingRate, formData.purchaseRate]);

  useEffect(() => {
    const initializeComponent = async () => {
      try {
        setIsLoading(true);
        setError(null);

        // Get base currency ID
        const { data: baseCurrency, error: currencyError } = await supabase
          .from('currencies')
          .select('id')
          .eq('is_base', true)
          .single();

        if (currencyError) throw currencyError;
        setBaseCurrencyId(baseCurrency.id);

        // Fetch currencies
        const { data: currencyData, error: currenciesError } = await supabase
          .from('currencies')
          .select('id, code')
          .order('code');

        if (currenciesError) {
          console.error('Error fetching currencies:', currenciesError);
          toast.error('Failed to fetch currencies');
          return;
        }

        setCurrencies(currencyData || []);

        // Fetch transaction types
        const { data: types, error: typeError } = await supabase
          .from('tbl_trans_type')
          .select('type_id, transaction_type_code, description')
          .in('transaction_type_code', ['MNGC', 'BNKT']);

        if (typeError) throw typeError;
        setTransactionTypes(types);
        if (types.length > 0) {
          const typeId = types[0].type_id;
          setTransactionTypeId(typeId);
          setFormData(prev => ({ ...prev, type: typeId }));
        }

        // Fetch commission account ID
        const { data: commissionAccount, error: commissionError } = await supabase
          .from('chart_of_accounts')
          .select('id')
          .eq('code', '0000000005')
          .single();

        if (commissionError) throw commissionError;
        setCommissionAccountId(commissionAccount.id);

        await fetchBusinessPartners();
      } catch (error) {
        console.error('Error initializing component:', error);
        setError('Failed to initialize form');
      } finally {
        setIsLoading(false);
      }
    };

    initializeComponent();
  }, []);

  // Fetch transactions when transaction type is set
  useEffect(() => {
    if (transactionTypeId) {
      fetchTransactionsForType(transactionTypeId);
    }
  }, [transactionTypeId]);

  const fetchBusinessPartners = async () => {
    try {
      const { data: subcategories, error: subcatError } = await supabase
        .from('subcategories')
        .select('id')
        .eq('name', 'Business Partner')
        .single();

      if (subcatError) {
        console.error('Error fetching subcategory:', subcatError);
        toast.error('Failed to fetch business partners');
        return;
      }

      const { data, error } = await supabase
        .from('chart_of_accounts')
        .select(`
          id,
          code,
          name
        `)
        .eq('is_active', true)
        .eq('subcategory_id', subcategories.id)
        .order('name');

      if (error) throw error;
      setBusinessPartners(data || []);
    } catch (error) {
      console.error('Error fetching business partners:', error);
      toast.error('Failed to fetch business partners');
    }
  };

  const getCurrencyCode = (currencyId: string): string => {
    const currency = currencies.find(c => c.id === currencyId);
    return currency?.code || '';
  };

  const fetchTransactionsForType = async (typeId: string) => {
    try {
      setIsLoading(true);
      const { data, error } = await supabase
        .from('gl_headers')
        .select(`
          id,
          voucher_no,
          transaction_date,
          description,
          status,
          gl_transactions (
            id,
            debit,
            credit,
            debit_doc_currency,
            credit_doc_currency,
            exchange_rate,
            currency_id,
            purchase_rate,
            sales_rate,
            account:chart_of_accounts (
              id,
              name
            )
          )
        `)
        .in('type_id', transactionTypes.map(t => t.type_id))
        .in('status', ['draft', 'posted'])
        .order('transaction_date', { ascending: false })
        .limit(limit);

      if (error) throw error;
      setTransactions(data || []);
    } catch (error) {
      console.error('Error fetching transactions:', error);
      toast.error('Failed to fetch transactions');
    } finally {
      setIsLoading(false);
    }
  };

  const fetchTransactions = () => {
    if (transactionTypeId) {
      fetchTransactionsForType(transactionTypeId);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!customer || !supplier) {
      toast.error('Please select both customer and supplier');
      return;
    }

    if (customer.id === supplier.id) {
      toast.error('Customer and supplier cannot be the same');
      return;
    }

    if (!transactionTypeId) {
      toast.error('Transaction type not configured');
      return;
    }

    if (!commissionAccountId) {
      toast.error('Commission account not configured');
      return;
    }

    if (!baseCurrencyId) {
      toast.error('Base currency not configured');
      return;
    }

    try {
      const amount = parseFloat(formData.amount);
      const sellingRate = parseFloat(formData.sellingRate);
      const purchaseRate = parseFloat(formData.purchaseRate);
      const commission = parseFloat(formData.commission);

      if (isNaN(amount) || amount <= 0) {
        toast.error('Please enter a valid amount');
        return;
      }

      if (isNaN(sellingRate) || isNaN(purchaseRate)) {
        toast.error('Please enter valid rates');
        return;
      }

      if (isNaN(commission)) {
        toast.error('Invalid commission calculation');
        return;
      }

      // Calculate amounts
      const customerDebit = amount + (amount / 100000) * sellingRate;
      const supplierCredit = amount + (amount / 100000) * purchaseRate;
      

      // Create header
      const { data: header, error: headerError } = await supabase
        .from('gl_headers')
        .insert({
          transaction_date: formData.date,
          type_id: transactionTypeId,
          description: formData.narration.toUpperCase(),
          status: 'posted'
        })
        .select()
        .single();

      if (headerError) throw headerError;

      // Create transactions array
      const transactions = [
        {
          header_id: header.id,
          account_id: customer.id,
          debit: customerDebit,
          credit: 0,
          debit_doc_currency: customerDebit,
          credit_doc_currency: 0,
          exchange_rate: 1, // Store selling rate for record purposes
          sales_rate: sellingRate, // Store selling rate in dedicated field
          purchase_rate: 0, // Not applicable for customer transaction
          currency_id: baseCurrencyId,
          description: formData.narration.toUpperCase(),
          amount: amount // Store original amount
        },
        {
          header_id: header.id,
          account_id: supplier.id,
          debit: 0,
          credit: supplierCredit,
          debit_doc_currency: 0,
          credit_doc_currency: supplierCredit,
          exchange_rate: 1, // Store purchase rate for record purposes
          purchase_rate: purchaseRate, // Store purchase rate in dedicated field
          sales_rate: 0, // Not applicable for supplier transaction
          currency_id: baseCurrencyId,
          description: formData.narration.toUpperCase(),
          amount: amount // Store original amount
        }
      ];

      // Add commission transaction if applicable
      if (commission > 0) {
        transactions.push({
          header_id: header.id,
          account_id: commissionAccountId,
          debit: 0,
          credit: commission,
          debit_doc_currency: 0,
          credit_doc_currency: commission, // Pass commission directly without conversion
          exchange_rate: 1, // Store selling rate for record purposes
          purchase_rate: 1, // Store both rates for commission transaction
          sales_rate: 1,
          currency_id: baseCurrencyId,
          description: `COMMISSION FOR ${formData.narration.toUpperCase()}`
        });
      }

      // Insert transactions
      const { error: transError } = await supabase
        .from('gl_transactions')
        .insert(transactions);

      if (transError) {
        // Rollback by deleting the header
        await supabase
          .from('gl_headers')
          .delete()
          .eq('id', header.id);
        throw transError;
      }

      toast.success('Transaction saved successfully');
      
      // Reset form
      setFormData({
        date: new Date().toISOString().split('T')[0],
        narration: '',
        amount: '',
        sellingRate: '',
        purchaseRate: '',
        commission: '0',
        type: transactionTypeId
      });
      setCustomer(null);
      setSupplier(null);

      // Refresh transactions
      fetchTransactions();
    } catch (error) {
      console.error('Error saving transaction:', error);
      toast.error('Failed to save transaction');
    }
  };

  const handleCancel = () => {
    if (formData.narration || formData.amount || formData.sellingRate || formData.purchaseRate || customer || supplier) {
      if (confirm('Are you sure you want to clear the form?')) {
        setFormData({
          date: new Date().toISOString().split('T')[0],
          narration: '',
          amount: '',
          sellingRate: '',
          purchaseRate: '',
          commission: '0',
          type: transactionTypeId || ''
        });
        setCustomer(null);
        setSupplier(null);
      }
    }
  };

  const handleEdit = (transactionId: string) => {
    navigate(`/transactions/bank/edit/${transactionId}`);
  };

  // Helper function to get transaction details for debugging
  const logTransactionDetails = (transaction: Transaction) => {
    const customerTrans = transaction.gl_transactions.find(t => t.debit > 0);
    const supplierTrans = transaction.gl_transactions.find(t => t.credit > 0 && t.account_id !== commissionAccountId);
    const commissionTrans = transaction.gl_transactions.find(t => t.account_id === commissionAccountId);
    
    console.log('Transaction Details:', {
      id: transaction.id,
      date: transaction.transaction_date,
      description: transaction.description,
      customer: customerTrans?.account.name,
      supplier: supplierTrans?.account.name,
      amount: customerTrans?.debit_doc_currency,
      commission: commissionTrans?.credit
    });
  };

  const getTransactionAmount = (transaction: Transaction): number => {
    const customerTransaction = transaction.gl_transactions.find(t => 
      t.account_id !== commissionAccountId && t.debit > 0
    );
    return customerTransaction?.debit_doc_currency || 0;
  };

  const getCustomerName = (transaction: Transaction): string => {
    // Find the customer transaction (debit entry)
    const customerTransaction = transaction.gl_transactions.find(t => 
      t.account_id !== commissionAccountId && t.debit > 0
    );
    
    return customerTransaction?.account.name || 'Unknown Customer';
  };

  const getSupplierName = (transaction: Transaction): string => {
    // Find the supplier transaction (credit entry)
    const supplierTransaction = transaction.gl_transactions.find(t => 
      t.account_id !== commissionAccountId && t.credit > 0
    );
    
    return supplierTransaction?.account.name || 'Unknown Supplier';
  };

  const getCommissionAmount = (transaction: Transaction): number => {
    // Find the commission transaction
    // First try to find by account ID
    let commissionTransaction = transaction.gl_transactions.find(t => 
      (t.account?.id === commissionAccountId || t.account_id === commissionAccountId) && t.credit > 0
    );
    
    // If not found, try to find by description containing "COMMISSION"
    if (!commissionTransaction) {
      commissionTransaction = transaction.gl_transactions.find(t => 
        t.description && t.description.includes('COMMISSION') && t.credit > 0
      );
    }
    
    // Log for debugging
    if (commissionTransaction) {
      console.log('Found commission transaction:', commissionTransaction);
    }
    
    return commissionTransaction?.credit || 0;
  };





  if (error) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-center">
          <p className="text-red-500 text-lg">{error}</p>
          <button
            onClick={() => window.location.reload()}
            className="mt-4 px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-center space-y-4">
          <div className="h-8 bg-gray-200 dark:bg-gray-700 rounded w-1/4 mx-auto mb-4 animate-pulse"></div>
          <div className="h-64 bg-gray-200 dark:bg-gray-700 rounded animate-pulse"></div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-semibold">Bank Transfer & Manager Cheque</h1>
      </div>

      {/* Entry Form */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow">
        <div className="p-6">
          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Date
                </label>
                <input
                  type="date"
                  value={formData.date}
                  onChange={(e) => setFormData({ ...formData, date: e.target.value })}
                  max={new Date().toISOString().split('T')[0]}
                  min={new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]}
                  className="w-full px-3 py-2 border rounded-lg dark:bg-gray-700 dark:border-gray-600 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Transaction Type
                </label>
                <select
                  value={formData.type}
                  onChange={(e) => {
                    const type = transactionTypes.find(t => t.type_id === e.target.value);
                    setTransactionTypeId(type?.type_id || null);
                    setFormData({ ...formData, type: e.target.value });
                  }}
                  className="w-full px-3 py-2 border rounded-lg dark:bg-gray-700 dark:border-gray-600 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  required
                >
                  {transactionTypes.map(type => (
                    <option key={type.type_id} value={type.type_id}>
                      {type.description}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Customer
                </label>
                <select
                  value={customer?.id || ''}
                  onChange={(e) => {
                    const partner = businessPartners.find(bp => bp.id === e.target.value);
                    setCustomer(partner || null);
                  }}
                  className="w-full px-3 py-2 border rounded-lg dark:bg-gray-700 dark:border-gray-600 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  required
                >
                  <option value="">Select Customer</option>
                  {businessPartners.map(bp => (
                    <option key={bp.id} value={bp.id}>
                      {bp.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Supplier
                </label>
                <select
                  value={supplier?.id || ''}
                  onChange={(e) => {
                    const partner = businessPartners.find(bp => bp.id === e.target.value);
                    setSupplier(partner || null);
                  }}
                  className="w-full px-3 py-2 border rounded-lg dark:bg-gray-700 dark:border-gray-600 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  required
                >
                  <option value="">Select Supplier</option>
                  {businessPartners.map(bp => (
                    <option key={bp.id} value={bp.id}>
                      {bp.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Narration
                </label>
                <input
                  type="text"
                  value={formData.narration}
                  onChange={(e) => setFormData({ ...formData, narration: e.target.value.toUpperCase() })}
                  className="w-full px-3 py-2 border rounded-lg dark:bg-gray-700 dark:border-gray-600 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  maxLength={100}
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Amount
                </label>
                <input
                  type="number"
                  value={formData.amount}
                  onChange={(e) => setFormData({ ...formData, amount: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg dark:bg-gray-700 dark:border-gray-600 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  min="0"
                  step="0.01"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Selling Rate
                </label>
                <input
                  type="number"
                  value={formData.sellingRate}
                  onChange={(e) => setFormData({ ...formData, sellingRate: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg dark:bg-gray-700 dark:border-gray-600 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  min="0"
                  step="0.0001"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Purchase Rate
                </label>
                <input
                  type="number"
                  value={formData.purchaseRate}
                  onChange={(e) => setFormData({ ...formData, purchaseRate: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg dark:bg-gray-700 dark:border-gray-600 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  min="0"
                  step="0.0001"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Commission
                </label>
                <input
                  type="number"
                  value={formData.commission}
                  readOnly
                  className="w-full px-3 py-2 border rounded-lg bg-gray-100 dark:bg-gray-600 dark:border-gray-500"
                />
              </div>
            </div>

            <div className="flex justify-end space-x-4">
              <button
                type="button"
                onClick={handleCancel}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-2 text-sm font-medium text-white bg-blue-600 border border-transparent rounded-lg hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
              >
                Save
              </button>
            </div>
          </form>
        </div>
      </div>

      {/* Transactions List */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow overflow-hidden">
        <div className="p-6">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-lg font-semibold">Recent Transactions</h2>
            <div className="flex space-x-2">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 h-4 w-4" />
                <input
                  type="text"
                  placeholder="Search transactions..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-10 pr-4 py-2 border rounded-lg w-64 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
              <thead>
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Date
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Description
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Customer
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Supplier
                  </th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Amount
                  </th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Commission
                  </th>
                  <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                {transactions.map((transaction) => (
                  <tr key={transaction.id}>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {new Date(transaction.transaction_date).toLocaleDateString()}
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-500">
                      {transaction.description}
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-500">
                      {getCustomerName(transaction)}
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-500">
                      {getSupplierName(transaction)}
                    </td>
                    <td className="px-6 py-4 text-right text-sm text-gray-500">
                      {formatAmount(getTransactionAmount(transaction))}
                    </td>
                    <td className="px-6 py-4 text-right text-sm text-gray-500">
                      {formatAmount(getCommissionAmount(transaction))}
                    </td>
                    <td className="px-6 py-4 text-center text-sm">
                      <button
                        onClick={() => handleEdit(transaction.id)}
                        className="text-blue-600 hover:text-blue-900 dark:hover:text-blue-400"
                      >
                        <Edit className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}