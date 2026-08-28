import { createClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface ServicePlan {
  code: string
  name: string
  category: 'PF' | 'PJ' | 'MOVEL' | 'ADICIONAL'
  price: number | null
  speed_mb: number | null
  description: string | null
  features: string[]
  is_active: boolean
  is_promo: boolean
}

interface CoverageArea {
  uf: string
  city: string
  neighborhood: string
  zone: string | null
  is_active: boolean
}

interface TelecomCustomer {
  external_id: string | null
  name: string
  phone: string | null
  email: string | null
  cpf_cnpj: string | null
  address: string | null
  number: string | null
  complement: string | null
  neighborhood: string | null
  city: string | null
  uf: string | null
  cep: string | null
  plan_code: string | null
  plan_value: number | null
  due_day: number | null
  seller_name: string | null
  status: string
  installation_date: string | null
  notes: string | null
}

// Parse CSV line handling quoted values
function parseCSVLine(line: string): string[] {
  const result: string[] = []
  let current = ''
  let inQuotes = false
  
  for (let i = 0; i < line.length; i++) {
    const char = line[i]
    if (char === '"') {
      inQuotes = !inQuotes
    } else if (char === ',' && !inQuotes) {
      result.push(current.trim())
      current = ''
    } else {
      current += char
    }
  }
  result.push(current.trim())
  return result
}

// Parse Brazilian date format to ISO
function parseDate(dateStr: string): string | null {
  if (!dateStr || dateStr.trim() === '') return null
  
  // Handle formats like "1/2/2025" or "31/12/24"
  const parts = dateStr.trim().split('/')
  if (parts.length !== 3) return null
  
  const day = parseInt(parts[0], 10)
  const month = parseInt(parts[1], 10)
  let year = parseInt(parts[2], 10)
  
  // Handle 2-digit year
  if (year < 100) {
    year = year > 50 ? 1900 + year : 2000 + year
  }
  
  if (isNaN(day) || isNaN(month) || isNaN(year)) return null
  
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

// Parse Brazilian currency format
function parseCurrency(value: string): number | null {
  if (!value || value.trim() === '' || value.includes('-')) return null
  
  // Remove "R$", spaces, and handle Brazilian format
  const cleaned = value
    .replace(/R\$/g, '')
    .replace(/\s/g, '')
    .replace(/\./g, '')  // Remove thousand separator
    .replace(',', '.')   // Convert decimal separator
    .trim()
  
  const num = parseFloat(cleaned)
  return isNaN(num) ? null : num
}

// Map status from spreadsheet to system
function mapStatus(status: string): string {
  const s = status?.trim().toUpperCase() || ''
  if (s.includes('INSTALADO')) return 'INSTALADOS'
  if (s.includes('CANCELADO')) return 'CANCELADO'
  if (s.includes('AGUARDANDO')) return 'AGUARDANDO'
  if (s.includes('SUSPENSO')) return 'SUSPENSO'
  if (s.includes('INADIMPLENTE')) return 'INADIMPLENTE'
  return 'NOVO'
}

// Parse customers from CSV text
function parseCustomersCSV(csvText: string): TelecomCustomer[] {
  const lines = csvText.split('\n').filter(l => l.trim())
  if (lines.length < 2) return []
  
  const customers: TelecomCustomer[] = []
  
  // Skip header line
  for (let i = 1; i < lines.length; i++) {
    const cols = parseCSVLine(lines[i])
    if (cols.length < 15) continue
    
    // Column mapping based on spreadsheet:
    // 0: #, 1: ID DO CLIENTE, 2: NOME, 3: TELEFONE, 4: DATA CONTRATAÇÃO, 
    // 5: STATUS, 6: DATA INSTALAÇÃO, 7: UF, 8: LOCALIDADE, 9: BAIRRO, 
    // 10: ENDEREÇO, 11: VENDEDOR, 12: TIPO, 13: PLANO, 14: ID PLANO, 
    // 15: VALOR, 16: CAT CHIP, 17: QTD CHIP, 18: REPETIDOR, 19: QTD REPT,
    // 20: COMBO, 21: DIA VENCIMENTO
    
    const name = cols[2]?.trim()
    if (!name) continue
    
    const externalId = cols[1]?.trim()
    const planCode = cols[14]?.trim()
    const planValue = parseCurrency(cols[15])
    const dueDay = parseInt(cols[21]?.trim() || '0', 10) || null
    
    // Normalize city name (replace underscores with spaces)
    const city = cols[8]?.trim().replace(/_/g, ' ')
    
    customers.push({
      external_id: externalId || null,
      name,
      phone: cols[3]?.trim() || null,
      email: null,
      cpf_cnpj: null,
      address: cols[10]?.trim() || null,
      number: null,
      complement: null,
      neighborhood: cols[9]?.trim() || null,
      city: city || null,
      uf: cols[7]?.trim() || null,
      cep: null,
      plan_code: planCode || null,
      plan_value: planValue,
      due_day: dueDay,
      seller_name: cols[11]?.trim() || null,
      status: mapStatus(cols[5]),
      installation_date: parseDate(cols[6]),
      notes: null,
    })
  }
  
  return customers
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    // Require authenticated super_admin — this endpoint inserts cross-tenant data with service role.
    const authHeader = req.headers.get('Authorization')
    if (!authHeader?.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }
    const token = authHeader.replace('Bearer ', '')
    const { data: { user }, error: authErr } = await supabase.auth.getUser(token)
    if (authErr || !user) {
      return new Response(JSON.stringify({ error: 'Invalid token' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }
    const { data: callerRole } = await supabase
      .from('user_roles')
      .select('role')
      .eq('user_id', user.id)
      .eq('role', 'super_admin')
      .maybeSingle()
    if (!callerRole) {
      return new Response(JSON.stringify({ error: 'Forbidden - super admin only' }), {
        status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const {
      organization_id,
      plans,
      coverage_areas,
      customers,
      customers_csv
    } = await req.json() as {
      organization_id: string
      plans?: ServicePlan[]
      coverage_areas?: CoverageArea[]
      customers?: TelecomCustomer[]
      customers_csv?: string
    }

    if (!organization_id) {
      throw new Error('organization_id is required')
    }

    console.log(`Starting seed for organization: ${organization_id}`)
    
    const results = {
      plans: { inserted: 0, errors: 0 },
      coverage_areas: { inserted: 0, errors: 0 },
      customers: { inserted: 0, errors: 0, skipped: 0 },
    }

    // 1. Insert service plans
    if (plans && plans.length > 0) {
      console.log(`Inserting ${plans.length} service plans...`)
      
      const planRecords = plans.map(plan => ({
        organization_id,
        code: plan.code,
        name: plan.name,
        category: plan.category,
        price: plan.price,
        speed_mb: plan.speed_mb,
        description: plan.description,
        features: plan.features || [],
        is_active: plan.is_active !== false,
        is_promo: plan.is_promo || false,
      }))

      const { data: insertedPlans, error: plansError } = await supabase
        .from('service_plans')
        .upsert(planRecords, { 
          onConflict: 'organization_id,code',
          ignoreDuplicates: false 
        })
        .select('id, code')

      if (plansError) {
        console.error('Error inserting plans:', plansError)
        results.plans.errors = plans.length
      } else {
        results.plans.inserted = insertedPlans?.length || plans.length
        console.log(`Inserted ${results.plans.inserted} plans`)
      }
    }

    // 2. Insert coverage areas
    if (coverage_areas && coverage_areas.length > 0) {
      console.log(`Inserting ${coverage_areas.length} coverage areas...`)
      
      const areaRecords = coverage_areas.map(area => ({
        organization_id,
        uf: area.uf,
        city: area.city,
        neighborhood: area.neighborhood,
        zone: area.zone,
        is_active: area.is_active !== false,
      }))

      const { error: areasError } = await supabase
        .from('coverage_areas')
        .upsert(areaRecords, { 
          onConflict: 'organization_id,uf,city,neighborhood',
          ignoreDuplicates: true 
        })

      if (areasError) {
        console.error('Error inserting coverage areas:', areasError)
        results.coverage_areas.errors = coverage_areas.length
      } else {
        results.coverage_areas.inserted = coverage_areas.length
        console.log(`Inserted ${results.coverage_areas.inserted} coverage areas`)
      }
    }

    // 3. Parse customers from CSV if provided
    let customersToInsert = customers || []
    if (customers_csv) {
      console.log('Parsing customers from CSV...')
      customersToInsert = parseCustomersCSV(customers_csv)
      console.log(`Parsed ${customersToInsert.length} customers from CSV`)
    }

    // 4. Insert customers
    if (customersToInsert.length > 0) {
      console.log(`Inserting ${customersToInsert.length} customers...`)

      // First, get all plans to create a lookup map
      const { data: existingPlans } = await supabase
        .from('service_plans')
        .select('id, code')
        .eq('organization_id', organization_id)

      const planLookup = new Map<string, string>()
      existingPlans?.forEach(plan => {
        planLookup.set(plan.code, plan.id)
      })

      console.log(`Plan lookup has ${planLookup.size} entries`)

      // Track seen external_ids to skip duplicates
      const seenIds = new Set<string>()

      // Process customers in batches of 100
      const batchSize = 100
      for (let i = 0; i < customersToInsert.length; i += batchSize) {
        const batch = customersToInsert.slice(i, i + batchSize)
        
        const customerRecords = batch
          .filter(customer => {
            // Skip if we've already seen this external_id
            if (customer.external_id && seenIds.has(customer.external_id)) {
              results.customers.skipped++
              return false
            }
            if (customer.external_id) {
              seenIds.add(customer.external_id)
            }
            return true
          })
          .map(customer => {
            const planId = customer.plan_code ? planLookup.get(customer.plan_code) : null
            
            return {
              organization_id,
              external_id: customer.external_id,
              name: customer.name,
              phone: customer.phone,
              email: customer.email,
              cpf_cnpj: customer.cpf_cnpj,
              address: customer.address,
              number: customer.number,
              complement: customer.complement,
              neighborhood: customer.neighborhood,
              city: customer.city,
              uf: customer.uf,
              cep: customer.cep,
              plan_id: planId,
              plan_value: customer.plan_value,
              due_day: customer.due_day,
              status: customer.status || 'NOVO',
              installation_date: customer.installation_date,
              notes: customer.seller_name 
                ? `Vendedor: ${customer.seller_name}${customer.notes ? '\n' + customer.notes : ''}`
                : customer.notes,
            }
          })

        if (customerRecords.length === 0) continue

        // Use insert with returning to track inserted rows
        const { data: insertedData, error: customersError } = await supabase
          .from('telecom_customers')
          .insert(customerRecords)
          .select('id')

        if (customersError) {
          // Try upsert as fallback (for updates)
          const { error: upsertError } = await supabase
            .from('telecom_customers')
            .upsert(customerRecords, { 
              onConflict: 'organization_id,external_id',
              ignoreDuplicates: false 
            })
          
          if (upsertError) {
            console.error(`Error inserting customer batch ${i}-${i + batchSize}:`, upsertError)
            results.customers.errors += customerRecords.length
          } else {
            results.customers.inserted += customerRecords.length
          }
        } else {
          results.customers.inserted += customerRecords.length
        }
      }

      console.log(`Inserted ${results.customers.inserted} customers, ${results.customers.skipped} skipped, ${results.customers.errors} errors`)
    }

    console.log('Seed completed:', results)

    return new Response(
      JSON.stringify({ 
        success: true, 
        results,
        message: `Importação concluída: ${results.plans.inserted} planos, ${results.coverage_areas.inserted} áreas, ${results.customers.inserted} clientes (${results.customers.skipped} duplicados)`
      }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200 
      }
    )

  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    console.error('Seed error:', error)
    return new Response(
      JSON.stringify({ success: false, error: errorMessage }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500 
      }
    )
  }
})
